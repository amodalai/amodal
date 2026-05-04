/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * STREAMING state handler.
 *
 * Consumes the provider's fullStream, emits text deltas to the client,
 * collects tool calls, and tracks token usage. Pre-executes read-only
 * tools while the LLM might still be generating.
 *
 * Transitions:
 * - No tool calls → DONE (model_stop)
 * - Tool calls collected → EXECUTING
 * - Stream error → DONE (error)
 */

import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import type {
  StreamingState,
  AgentContext,
  TransitionResult,
  ToolCall,
} from '../loop-types.js';
import {executeTool} from './executing.js';

/**
 * Handle the STREAMING state.
 */
export async function handleStreaming(
  state: StreamingState,
  ctx: AgentContext,
  onEffect?: (event: SSEEvent) => void,
): Promise<TransitionResult> {
  const effects: SSEEvent[] = [];
  const emit = (event: SSEEvent) => {
    if (onEffect) onEffect(event);
    else effects.push(event);
  };
  const toolCalls: ToolCall[] = [...state.pendingToolCalls];

  // Attach passive error handlers to the derived promises BEFORE iterating
  // fullStream. The AI SDK's StreamTextResult exposes fullStream + text +
  // usage as separate promises that share an underlying provider fetch.
  // When ctx.signal aborts, the fetch rejects, fullStream's .next() throws,
  // and this for-await propagates that throw — which means we may exit
  // before `await state.stream.text` (line ~137) ever runs. Without these
  // handlers, the unawaited text/usage rejections escape as unhandled
  // promise rejections and crash the process.
  // These handlers are intentionally silent: the real error is surfaced
  // either via a 'error' event on fullStream (caught below) or via the
  // thrown stream error that propagates up the for-await to runAgent's
  // caller's try/catch.
  Promise.resolve(state.stream.text).catch(() => {});
  Promise.resolve(state.stream.usage).catch(() => {});
  Promise.resolve(state.stream.responseMessages).catch(() => {});

  // Consume the full stream
  for await (const event of state.stream.fullStream) {
    if (ctx.signal.aborted) break;

    switch (event.type) {
      case 'text-delta': {
        emit({
          type: SSEEventType.TextDelta,
          content: event.textDelta,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'tool-call': {
        const call: ToolCall = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        };
        toolCalls.push(call);

        // Pre-execute read-only tools while the model might still be generating.
        // executeTool returns {output, inlineEvents} — tools like
        // `present_connection` and `show_preview` need their emissions to
        // survive the cache hand-off to EXECUTING.
        const toolDef = ctx.toolRegistry.get(event.toolName);
        if (toolDef?.readOnly) {
          const promise = executeTool(call, toolDef, ctx);
          // Log but suppress rejection — errors are re-surfaced when awaited in EXECUTING.
          // Without this, abort before reaching EXECUTING causes unhandled rejection.
          promise.catch((err: unknown) => {
            ctx.logger.debug('preexec_suppressed', {
              tool: event.toolName,
              callId: event.toolCallId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          ctx.preExecutionCache.set(event.toolCallId, promise);
        }
        break;
      }

      case 'finish': {
        // Track token usage
        const usage = event.usage;
        ctx.usage.inputTokens += usage.inputTokens;
        ctx.usage.outputTokens += usage.outputTokens;
        ctx.usage.totalTokens += usage.inputTokens + usage.outputTokens;
        if (usage.cachedInputTokens) {
          ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + usage.cachedInputTokens;
        }
        if (usage.cacheCreationInputTokens) {
          ctx.usage.cacheCreationInputTokens = (ctx.usage.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
        }

        // Fire onUsage hook (billing, metering)
        if (ctx.onUsage) {
          ctx.onUsage({
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
            totalTokens: usage.inputTokens + usage.outputTokens,
            turnNumber: ctx.turnCount,
          });
        }
        break;
      }

      case 'tool-result':
        // We don't pass execute functions to the AI SDK, so tool-result events
        // should not arrive. If they do (provider auto-execution), ignore them —
        // we handle tool execution ourselves in EXECUTING state.
        break;

      case 'error': {
        ctx.logger.error('provider_stream_error', {
          session: ctx.sessionId,
          error: event.error instanceof Error ? event.error.message : String(event.error),
          turn: ctx.turnCount,
        });
        emit({
          type: SSEEventType.Error,
          message: event.error instanceof Error ? event.error.message : String(event.error),
          timestamp: new Date().toISOString(),
        });
        return {
          next: {type: 'done', usage: {...ctx.usage}, reason: 'error'},
          effects,
        };
      }

      default:
        // Future stream event types — skip
        break;
    }
  }

  // Append the SDK's response messages (not manually constructed) so that
  // provider-specific metadata — like Gemini 3's thought signatures — is
  // preserved. Without this, Gemini 3 rejects the next turn with
  // "Function call is missing a thought_signature."
  //
  // CRITICAL: filter out any role:'tool' entries the SDK includes here.
  // We strip `execute` from tool definitions before passing them to
  // streamText (see thinking.ts), so the SDK has no business emitting
  // tool-result messages — but in practice it sometimes includes
  // placeholder tool-result entries alongside the assistant's tool-call
  // message. The EXECUTING state is the authoritative source of
  // tool-result messages; if the SDK's placeholders also land in
  // ctx.messages, every tool call ends up with two tool-result entries
  // and Anthropic rejects the next turn with "each tool_use must have
  // a single result." Provider metadata we care about lives on the
  // assistant message, so dropping the tool entries is safe.
  const responseMessages = await state.stream.responseMessages;
  const filteredResponseMessages = responseMessages.filter((m) => m.role !== 'tool');
  ctx.messages = [...ctx.messages, ...filteredResponseMessages];

  // No tool calls → model is done
  if (toolCalls.length === 0) {
    return {
      next: {type: 'done', usage: {...ctx.usage}, reason: 'model_stop'},
      effects,
    };
  }

  // Tool calls → transition to EXECUTING
  const [first, ...rest] = toolCalls;
  return {
    next: {type: 'executing', queue: rest, current: first, results: []},
    effects,
  };
}

/**
 * Async generator variant of handleStreaming that yields SSE events
 * incrementally as the LLM generates tokens. The final yield is a
 * TransitionResult so the caller knows the next state.
 */
export async function* handleStreamingIncremental(
  state: StreamingState,
  ctx: AgentContext,
): AsyncGenerator<SSEEvent | TransitionResult> {
  const toolCalls: ToolCall[] = [...state.pendingToolCalls];

  Promise.resolve(state.stream.text).catch(() => {});
  Promise.resolve(state.stream.usage).catch(() => {});
  Promise.resolve(state.stream.responseMessages).catch(() => {});

  for await (const event of state.stream.fullStream) {
    if (ctx.signal.aborted) break;

    switch (event.type) {
      case 'text-delta': {
        yield {
          type: SSEEventType.TextDelta,
          content: event.textDelta,
          timestamp: new Date().toISOString(),
        };
        break;
      }

      case 'tool-call': {
        const call: ToolCall = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        };
        toolCalls.push(call);

        const toolDef = ctx.toolRegistry.get(event.toolName);
        if (toolDef?.readOnly) {
          const promise = executeTool(call, toolDef, ctx);
          promise.catch((err: unknown) => {
            ctx.logger.debug('preexec_suppressed', {
              tool: event.toolName,
              callId: event.toolCallId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          ctx.preExecutionCache.set(event.toolCallId, promise);
        }
        break;
      }

      case 'finish': {
        const usage = event.usage;
        ctx.usage.inputTokens += usage.inputTokens;
        ctx.usage.outputTokens += usage.outputTokens;
        ctx.usage.totalTokens += usage.inputTokens + usage.outputTokens;
        if (usage.cachedInputTokens) {
          ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + usage.cachedInputTokens;
        }
        if (usage.cacheCreationInputTokens) {
          ctx.usage.cacheCreationInputTokens = (ctx.usage.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
        }
        if (ctx.onUsage) {
          ctx.onUsage({
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens ?? 0,
            cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
            totalTokens: usage.inputTokens + usage.outputTokens,
            turnNumber: ctx.turnCount,
          });
        }
        break;
      }

      case 'tool-result':
        break;

      case 'error': {
        ctx.logger.error('provider_stream_error', {
          session: ctx.sessionId,
          error: event.error instanceof Error ? event.error.message : String(event.error),
          turn: ctx.turnCount,
        });
        yield {
          type: SSEEventType.Error,
          message: event.error instanceof Error ? event.error.message : String(event.error),
          timestamp: new Date().toISOString(),
        };
        yield {next: {type: 'done', usage: {...ctx.usage}, reason: 'error'}, effects: []};
        return;
      }

      default:
        break;
    }
  }

  const responseMessages = await state.stream.responseMessages;
  ctx.messages = [...ctx.messages, ...responseMessages];

  if (toolCalls.length === 0) {
    yield {next: {type: 'done', usage: {...ctx.usage}, reason: 'model_stop'}, effects: []};
    return;
  }

  const [first, ...rest] = toolCalls;
  yield {next: {type: 'executing', queue: rest, current: first, results: []}, effects: []};
}

