/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * The bypass executor for matched intents.
 *
 * Drives a handler from start to finish, emitting SSE events as tools
 * fire and assembling the synthetic assistant + tool result messages
 * that get appended to `session.messages` at the end. The shape of
 * those messages mirrors what the agent loop produces for the
 * equivalent LLM-driven turn — same tool-call parts, same tool result
 * messages — so chat rehydration on reload renders the cards
 * identically without any client-side branching.
 *
 * Concurrency model: `runIntent` is an async generator. The handler
 * runs in parallel via a chained promise; each `ctx.callTool(...)`
 * pushes events into a queue, the generator yields them as they
 * arrive, then waits for the handler to settle. This lets the user
 * see tool-call cards stream in one at a time instead of all at the
 * end.
 */

import {randomUUID} from 'node:crypto';
import type {IntentContext, IntentResult} from '@amodalai/types';
import type {ModelMessage} from 'ai';
import type {ToolDefinition, ToolContext} from '../tools/types.js';
import type {ToolRegistry} from '../tools/types.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import {ToolExecutionError} from '../errors.js';
import type {Logger} from '../logger.js';
import type {IntentMatch} from './matcher.js';

// ---------------------------------------------------------------------------
// Shared queue used by callTool to push events that runIntent yields
// ---------------------------------------------------------------------------

/**
 * Single-producer / single-consumer event queue. callTool pushes
 * events as the tool runs; runIntent's outer loop awaits next() and
 * yields each event onto the SSE stream. `finish()` is called when
 * the handler resolves so the consumer can exit the loop.
 *
 * `next()` returns `SSEEvent | null` (null = stream closed) instead
 * of an IteratorResult — this isn't an Iterator itself, just an
 * internal queue, and the simpler signature avoids casting around
 * the IteratorResult value-when-done quirk.
 */
class IntentEventQueue {
  private buffer: SSEEvent[] = [];
  private waiters: Array<(r: SSEEvent | null) => void> = [];
  private done = false;

  push(event: SSEEvent): void {
    const w = this.waiters.shift();
    if (w) {
      w(event);
    } else {
      this.buffer.push(event);
    }
  }

  finish(): void {
    this.done = true;
    let w = this.waiters.shift();
    while (w !== undefined) {
      w(null);
      w = this.waiters.shift();
    }
  }

  next(): Promise<SSEEvent | null> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.done) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

// ---------------------------------------------------------------------------
// Label resolution (mirrors the helper in executing.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve `{{paramName}}` placeholders in a label template against the
 * call's params. Same semantics as the executing-state helper —
 * missing/non-string params drop out, adjacent whitespace collapses.
 * Duplicated here rather than imported to keep the executing-state
 * helper internal; if a third caller appears we pull it up to a
 * shared module.
 */
function resolveLabelTemplate(template: string, params: Record<string, unknown>): string {
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  });
  return filled.replace(/\s+/g, ' ').trim();
}

/**
 * Mirrors `sanitizeParams` in executing.ts — strips token/secret/etc.
 * fields from tool params before they leave the runtime as SSE
 * events. Synthetic tool calls from intents go through the same wire
 * as agent-loop tool calls; secret keys would leak otherwise.
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (/token|secret|password|key|auth/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Render a tool's raw output as a JSON-or-text string suitable for
 * the AI SDK's text-typed tool-result content. Mirrors the
 * `buildToolResultMessage` path in executing.ts: strings pass
 * through, everything else gets JSON-stringified. Keeps the
 * synthetic tool result message identical in shape to what the
 * agent loop would have appended.
 */
function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

// ---------------------------------------------------------------------------
// runIntent
// ---------------------------------------------------------------------------

export interface RunIntentOptions {
  /** Matched intent + RegExpExecArray. */
  match: IntentMatch;
  /** The original user message that fired the match. */
  userMessage: string;
  sessionId: string;
  scopeId: string;
  /** Session's tool registry — handlers invoke tools by name. */
  toolRegistry: ToolRegistry;
  /** Builds a ToolContext per tool call (same factory the agent loop uses). */
  buildToolContext: (callId: string) => ToolContext;
  logger: Logger;
}

export type IntentRunOutcome =
  | {kind: 'completed'; assistantMessage: ModelMessage; toolMessages: ModelMessage[]}
  | {
      kind: 'completedContinue';
      assistantMessage: ModelMessage;
      toolMessages: ModelMessage[];
    }
  | {kind: 'fellThrough'}
  | {kind: 'errored'; error: Error};

/**
 * Drive a matched intent and yield SSE events as the handler runs.
 *
 * Returns (via the generator's return value) one of:
 *   - `completed` with the synthetic messages to append to session.messages
 *   - `fellThrough` when the handler returned null BEFORE any tool ran
 *     (caller falls through to the LLM)
 *   - `errored` when the handler threw or a tool throw bubbled
 */
export async function* runIntent(
  opts: RunIntentOptions,
): AsyncGenerator<SSEEvent, IntentRunOutcome> {
  const startedAt = Date.now();
  const queue = new IntentEventQueue();
  const messageParts: Array<{
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }> = [];
  const toolMessages: ModelMessage[] = [];
  let textContent = '';
  let toolCallsStarted = 0;

  opts.logger.info('intent_matched', {
    intentId: opts.match.intent.id,
    sessionId: opts.sessionId,
  });

  /** Reject reason used internally when an intent should abort BUT not
   *  fall through (e.g. a tool gates on confirmation). The runtime
   *  catches this and emits an error SSE so the user sees what
   *  happened, rather than silently skipping to the LLM after we've
   *  potentially emitted other events. */
  class IntentAbortError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'IntentAbortError';
    }
  }

  const ctx: IntentContext = {
    match: opts.match.match,
    userMessage: opts.userMessage,
    sessionId: opts.sessionId,
    scopeId: opts.scopeId,

    async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
      const tool = opts.toolRegistry.get(toolName);
      if (!tool) {
        throw new IntentAbortError(
          `Intent "${opts.match.intent.id}" tried to call unknown tool "${toolName}".`,
        );
      }

      // Confirmation gate: intents are restricted to the deterministic
      // happy path. Anything that needs user judgment (a tool flagged
      // as `requiresConfirmation` or any connection-tool ACL gate)
      // routes through the agent loop where CONFIRMING handles it.
      if (toolGatesOnConfirmation(tool)) {
        opts.logger.warn('intent_blocked_by_confirmation', {
          intentId: opts.match.intent.id,
          sessionId: opts.sessionId,
          toolName,
        });
        throw new IntentAbortError(
          `Tool "${toolName}" requires confirmation; intents can't bypass that gate.`,
        );
      }

      // Validate params via the tool's Zod schema (skipped silently
      // for jsonSchema()-defined tools, same as the agent loop).
      if ('safeParse' in tool.parameters) {
        const validation = tool.parameters.safeParse(params);
        if (!validation.success) {
          throw new IntentAbortError(
            `Intent "${opts.match.intent.id}" emitted invalid params for "${toolName}": ${validation.error.message}`,
          );
        }
      }

      toolCallsStarted++;
      const toolCallId = `intent_${randomUUID()}`;
      const toolContext = opts.buildToolContext(toolCallId);
      const startedAt = Date.now();

      // Sanitized params for the wire — labels resolve from the
      // ORIGINAL params (a redacted token in a label is fine; a label
      // built off `[REDACTED]` looks weird).
      const sanitizedParams = sanitizeParams(params);
      const startEvent: SSEEvent = {
        type: SSEEventType.ToolCallStart,
        tool_name: toolName,
        tool_id: toolCallId,
        parameters: sanitizedParams,
        ...(tool.runningLabel
          ? {running_label: resolveLabelTemplate(tool.runningLabel, params)}
          : {}),
        ...(tool.completedLabel
          ? {completed_label: resolveLabelTemplate(tool.completedLabel, params)}
          : {}),
        timestamp: new Date().toISOString(),
      };
      queue.push(startEvent);

      let output: unknown;
      try {
        output = await tool.execute(params, toolContext);
      } catch (err) {
        const duration_ms = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        // Drain any inline events the tool managed to emit before throwing.
        // ToolInlineEvent is a structural subset of SSEEvent (same SSE
        // discriminated-union members), but they live in different files
        // — go through unknown to satisfy strict variance.
        for (const e of toolContext.inlineEvents ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ToolInlineEvent is a structural subset of SSEEvent (same shapes, two declaration sites)
          queue.push(e as unknown as SSEEvent);
        }
        queue.push({
          type: SSEEventType.ToolCallResult,
          tool_id: toolCallId,
          status: 'error',
          duration_ms,
          error: message,
          timestamp: new Date().toISOString(),
        });
        throw new ToolExecutionError(
          `Intent "${opts.match.intent.id}" tool "${toolName}" failed: ${message}`,
          {toolName, callId: toolCallId, cause: err instanceof Error ? err : undefined},
        );
      }

      const duration_ms = Date.now() - startedAt;

      // Drain inline events the tool emitted via ctx.emit (panels,
      // ask_choice, plan_summary, tool_label_update, etc.). Same
      // semantics as the agent loop — these arrive between the tool's
      // start and result so the chat renders them in the right order.
      for (const e of toolContext.inlineEvents ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ToolInlineEvent is a structural subset of SSEEvent (same shapes, two declaration sites)
        queue.push(e as unknown as SSEEvent);
      }

      const resultEvent = buildSuccessResultEvent(toolCallId, output, duration_ms);
      queue.push(resultEvent);

      messageParts.push({
        type: 'tool-call',
        toolCallId,
        toolName,
        input: params,
      });
      // Match the agent loop's `buildToolResultMessage` shape: text-as-string.
      // The AI SDK accepts either {type:'text',value:string} or
      // {type:'json',value:JSON}, but the agent loop always uses text so
      // session.messages stays uniform across intent-driven and LLM-driven
      // turns. Without this, rehydration would render two different shapes
      // depending on which path produced the turn.
      toolMessages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            output: {type: 'text', value: stringifyToolOutput(output)},
          },
        ],
      });

      return output;
    },

    emitText(text: string): void {
      textContent += text;
      queue.push({
        type: SSEEventType.TextDelta,
        content: text,
        timestamp: new Date().toISOString(),
      });
    },
  };

  // Drive the handler in parallel; the `finally` always closes the queue.
  // Wrapped in a state object because TS can't follow assignments to
  // bare `let` variables across the IIFE's closure boundary.
  const handlerState: {
    error: Error | null;
    result: IntentResult | null | undefined;
  } = {error: null, result: undefined};
  const handlerPromise = (async () => {
    try {
      handlerState.result = await opts.match.intent.handle(ctx);
    } catch (err) {
      handlerState.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      queue.finish();
    }
  })();

  // Yield events as they're produced by callTool / emitText.
  // The loop exits when queue.finish() runs (in the handler's finally).
  let event = await queue.next();
  while (event !== null) {
    yield event;
    event = await queue.next();
  }

  // Make sure the handler promise is fully settled before we read state.
  await handlerPromise;

  // Errors: emit an error SSE for the user and report the outcome to
  // the caller. We don't fall through after errors — the user saw the
  // failure mid-flight and the next user turn can do whatever they
  // want (retry, type something more general → LLM).
  if (handlerState.error !== null) {
    const err = handlerState.error;
    opts.logger.warn('intent_errored', {
      intentId: opts.match.intent.id,
      sessionId: opts.sessionId,
      toolCallsStarted,
      durationMs: Date.now() - startedAt,
      error: err.message,
    });
    yield {
      type: SSEEventType.Error,
      message: err.message,
      timestamp: new Date().toISOString(),
    };
    return {kind: 'errored', error: err};
  }

  // Handler returned null → fall through, but only if no tool calls
  // ran. If callTool was invoked, we've emitted SSE events to the
  // user; falling through to the LLM at this point would double-fire
  // the turn. Treat post-commit nulls as completions and warn.
  if (handlerState.result === null) {
    if (toolCallsStarted === 0) {
      opts.logger.info('intent_fell_through', {
        intentId: opts.match.intent.id,
        sessionId: opts.sessionId,
        durationMs: Date.now() - startedAt,
      });
      return {kind: 'fellThrough'};
    }
    opts.logger.warn('intent_returned_null_after_committing', {
      intentId: opts.match.intent.id,
      sessionId: opts.sessionId,
      toolCallsStarted,
    });
    // Fall through to completion — same as a normal success.
  }

  // Compose the synthetic assistant message. Always emit a Done
  // event so the SSE stream terminates the same way it does for an
  // LLM-driven turn.
  const assistantContent: ModelMessage['content'] = [
    ...(textContent ? [{type: 'text' as const, text: textContent}] : []),
    ...messageParts,
  ];
  const assistantMessage: ModelMessage = {
    role: 'assistant',
    content: assistantContent.length > 0 ? assistantContent : '',
  };

  // Don't emit Done for completedContinue — the agent loop will emit
  // its own Done after the LLM turn finishes. Emitting two Done
  // events would tear down the SSE stream client-side prematurely.
  const wantsContinue =
    handlerState.result !== null &&
    handlerState.result !== undefined &&
    'continue' in handlerState.result &&
    handlerState.result.continue === true;

  if (!wantsContinue) {
    yield {type: SSEEventType.Done, timestamp: new Date().toISOString()};
  }

  opts.logger.info('intent_completed', {
    intentId: opts.match.intent.id,
    sessionId: opts.sessionId,
    toolCount: toolCallsStarted,
    hasText: textContent.length > 0,
    durationMs: Date.now() - startedAt,
    continueToLlm: wantsContinue,
  });

  return {
    kind: wantsContinue ? 'completedContinue' : 'completed',
    assistantMessage,
    toolMessages,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when invoking this tool would normally route through CONFIRMING
 * (tool-level flag or connection ACL gates). Intents can't honor that
 * loop without re-implementing the agent state machine, so we refuse
 * and fall through to the LLM.
 */
function toolGatesOnConfirmation(tool: ToolDefinition): boolean {
  if (tool.requiresConfirmation === true) return true;
  // Connection tools are ACL-gated; the gate decision lives in the
  // PermissionChecker which we don't run from the intent path.
  // Conservative default: refuse all connection-category tools.
  if (tool.metadata?.category === 'connection') return true;
  return false;
}

/** Max size for tool result content sent via SSE (mirrors executing.ts). */
const MAX_SSE_RESULT_SIZE = 50_000;

function buildSuccessResultEvent(
  toolCallId: string,
  output: unknown,
  duration_ms: number,
): SSEEvent {
  const stringified =
    typeof output === 'string' ? output : safeJsonStringify(output);
  const result =
    stringified.length > MAX_SSE_RESULT_SIZE
      ? stringified.slice(0, MAX_SSE_RESULT_SIZE) + '\n[... truncated]'
      : stringified;
  return {
    type: SSEEventType.ToolCallResult,
    tool_id: toolCallId,
    status: 'success',
    duration_ms,
    result,
    timestamp: new Date().toISOString(),
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
