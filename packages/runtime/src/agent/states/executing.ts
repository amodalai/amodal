/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * EXECUTING state handler.
 *
 * Runs tool calls from the queue. Contiguous read-only calls at the head
 * of the queue are batched and executed concurrently via Promise.all;
 * writes, confirmation-gated tools, and connection-ACL tools run one at
 * a time so their per-call state-machine gates (CONFIRMING transitions,
 * ACL checks) can evaluate individually.
 *
 * Per-call steps (single or batched):
 * 1. Look up tool in registry
 * 2. Check permissions (via PermissionChecker)
 * 3. Execute the tool (or use pre-execution cache)
 * 4. Emit SSE events for tool_call_start / tool_call_result
 * 5. After all calls done: check context size → COMPACTING or THINKING
 *
 * Tool execution errors are "continue sites" — the error becomes an
 * observation for the model, not a crash.
 */

import type {ModelMessage} from 'ai';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import type {ToolDefinition} from '../../tools/types.js';
import type {
  ExecutingState,
  AgentContext,
  TransitionResult,
  ToolCall,
  ToolResult,
  ToolResultContentBlock,
} from '../loop-types.js';
import {MAX_IMAGE_BLOCK_SIZE, MAX_TOTAL_IMAGE_SIZE, contentBlocksToString} from '../loop-types.js';
import {estimateTokenCount} from '../token-estimate.js';
import {DISPATCH_TOOL_NAME} from '../../tools/dispatch-tool.js';

/**
 * Handle the EXECUTING state — execute a single tool call.
 */
export async function handleExecuting(
  state: ExecutingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  const {current, queue} = state;
  const effects: SSEEvent[] = [];
  const timestamp = new Date().toISOString();

  // 1. Look up the tool
  const toolDef = ctx.toolRegistry.get(current.toolName);
  if (!toolDef) {
    const result: ToolResult = {
      callId: current.toolCallId,
      toolName: current.toolName,
      status: 'error',
      content: `Tool "${current.toolName}" not found. Available tools: ${ctx.toolRegistry.names().join(', ')}`,
    };
    ctx.logger.warn('tool_not_found', {
      tool: current.toolName,
      session: ctx.sessionId,
    });
    return nextAfterToolResult(state, result, effects, ctx);
  }

  // 2. Validate args against schema (cheap guard against hallucinated params)
  //    Only for Zod schemas — FlexibleSchema (MCP/custom tools) uses jsonSchema()
  //    which is validated by the AI SDK at the provider level.
  if ('safeParse' in toolDef.parameters) {
    const validation = toolDef.parameters.safeParse(current.args);
    if (!validation.success) {
      const result: ToolResult = {
        callId: current.toolCallId,
        toolName: current.toolName,
        status: 'error',
        content: `Invalid parameters: ${validation.error.message}`,
      };
      ctx.logger.warn('tool_args_invalid', {
        tool: current.toolName,
        callId: current.toolCallId,
        session: ctx.sessionId,
        errors: validation.error.issues,
      });
      return nextAfterToolResult(state, result, effects, ctx);
    }
  }

  // 3a. Tool-level confirmation gate — applies to any tool that sets
  //     `requiresConfirmation: true`. Routes through CONFIRMING on the first
  //     call; subsequent passes (after user approval) are tracked in
  //     `ctx.confirmedCallIds` to avoid an infinite EXECUTING → CONFIRMING
  //     loop. Connection tools handle confirmation via their ACL path below
  //     and should leave this flag undefined.
  if (toolDef.requiresConfirmation && !ctx.confirmedCallIds.has(current.toolCallId)) {
    ctx.logger.info('tool_confirmation_required', {
      tool: current.toolName,
      callId: current.toolCallId,
      session: ctx.sessionId,
      reason: 'tool_flagged_requires_confirmation',
    });
    return {
      next: {type: 'confirming', call: current, remainingQueue: queue},
      effects: [...effects, {
        type: SSEEventType.ConfirmationRequired,
        endpoint: current.toolName,
        method: 'EXECUTE',
        reason: `Tool "${current.toolName}" requires user confirmation`,
        escalated: false,
        timestamp,
      }],
    };
  }

  // 3b. Connection-tool ACL check — access.json rules with endpoint-level
  //     allow/deny/confirm tiers. Store/admin tools have their own guards
  //     (read-only paths, blocked filenames, schema validation).
  if (toolDef.metadata?.category === 'connection' && toolDef.metadata.connection) {
    const method = typeof current.args['method'] === 'string' ? current.args['method'] : 'GET';
    const endpoint = typeof current.args['endpoint'] === 'string' ? current.args['endpoint'] : '/';
    const rawIntent = current.args['intent'];
    const intent: 'read' | 'write' | 'confirmed_write' =
      rawIntent === 'write' || rawIntent === 'confirmed_write' ? rawIntent : 'read';

    const permResult = ctx.permissionChecker.check({
      connection: toolDef.metadata.connection,
      endpointPath: `${method} ${endpoint}`,
      intent,
      method,
      params: current.args,
    });

    if (!permResult.allowed) {
      const result: ToolResult = {
        callId: current.toolCallId,
        toolName: current.toolName,
        status: 'error',
        content: `Permission denied: ${permResult.reason}`,
      };
      ctx.logger.warn('tool_permission_denied', {
        tool: current.toolName,
        reason: permResult.reason,
        session: ctx.sessionId,
      });
      return nextAfterToolResult(state, result, effects, ctx);
    }

    if (
      permResult.allowed &&
      permResult.requiresConfirmation &&
      !ctx.confirmedCallIds.has(current.toolCallId)
    ) {
      return {
        next: {type: 'confirming', call: current, remainingQueue: queue},
        effects: [...effects, {
          type: SSEEventType.ConfirmationRequired,
          endpoint,
          method,
          reason: permResult.reason,
          escalated: false,
          timestamp,
        }],
      };
    }
  }

  // 4. Intercept dispatch_task — transition to DISPATCHING instead of executing
  if (current.toolName === DISPATCH_TOOL_NAME) {
    const args = current.args;
    const rawTools = Array.isArray(args['tools']) ? args['tools'] : [];
    const toolSubset = rawTools
      .filter((t): t is string => typeof t === 'string')
      .filter((t) => t !== DISPATCH_TOOL_NAME);

    effects.push({
      type: SSEEventType.ToolCallStart,
      tool_name: current.toolName,
      tool_id: current.toolCallId,
      parameters: sanitizeParams(current.args),
      timestamp,
    });

    return {
      next: {
        type: 'dispatching',
        task: {
          agentName: String(args['agent_name'] ?? 'sub-agent'),
          toolSubset,
          prompt: String(args['prompt'] ?? ''),
          maxTurns: typeof args['max_turns'] === 'number' ? args['max_turns'] : undefined,
        },
        toolCallId: current.toolCallId,
        queue,
        results: state.results,
      },
      effects,
    };
  }

  // 5. Decide: can we batch this call with leading read-only calls from the
  //    queue? Batching lets independent read-only tools run concurrently
  //    instead of taking one EXECUTING transition per call. Non-batchable
  //    calls (writes, confirmation-required, connection ACL, dispatch) still
  //    flow through the single-call path for correctness.
  const batch = collectBatch(current, toolDef, queue, ctx);
  if (batch.calls.length > 1) {
    return executeBatch(state, batch, effects, ctx);
  }

  // Single-call path: execute the current tool, emit events, advance state.
  effects.push(buildToolCallStartEvent(current, timestamp));
  const {result, duration, inlineEvents} = await runToolCall(current, toolDef, ctx);
  effects.push(...inlineEvents);
  effects.push(buildToolCallResultEvent(current, result, duration));
  ctx.logger.info('tool_call', {
    tool: current.toolName,
    callId: current.toolCallId,
    status: result.status,
    session: ctx.sessionId,
    duration,
  });

  return nextAfterToolResult(state, result, effects, ctx);
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

interface BatchItem {
  call: ToolCall;
  toolDef: ToolDefinition;
}

interface Batch {
  calls: BatchItem[];
  /** Queue remainder after batched items were drained from its head. */
  remainingQueue: ToolCall[];
}

/**
 * A call is batchable when it can't trigger a mid-queue state-machine
 * transition. Connection tools are excluded because their ACL check can
 * return `requiresConfirmation`, which would need a transition to
 * CONFIRMING — and a batch can only produce one `next` state.
 * Confirmation-flagged and dispatch tools are excluded for the same
 * reason: the state machine must route them individually.
 */
function isBatchable(toolDef: ToolDefinition): boolean {
  return (
    toolDef.readOnly === true &&
    !toolDef.requiresConfirmation &&
    toolDef.metadata?.category !== 'connection'
  );
}

/**
 * Collect the current call plus the leading contiguous run of batchable
 * calls from the queue. Stops at the first non-batchable call so writes
 * and gated calls stay sequential.
 */
function collectBatch(
  current: ToolCall,
  currentToolDef: ToolDefinition,
  queue: ToolCall[],
  ctx: AgentContext,
): Batch {
  if (!isBatchable(currentToolDef)) {
    return {calls: [{call: current, toolDef: currentToolDef}], remainingQueue: queue};
  }

  const calls: BatchItem[] = [{call: current, toolDef: currentToolDef}];
  let i = 0;
  for (; i < queue.length; i++) {
    const peek = queue[i];
    const peekDef = ctx.toolRegistry.get(peek.toolName);
    if (!peekDef || !isBatchable(peekDef)) break;
    calls.push({call: peek, toolDef: peekDef});
  }
  return {calls, remainingQueue: queue.slice(i)};
}

/**
 * Run a batch of read-only tool calls concurrently. Emits per-call
 * ToolCallStart events first (so UIs can render N in-flight cards at once),
 * awaits all results via Promise.all, then emits per-call ToolCallResult
 * events in the original call order. A failure in one call does not block
 * the others — each produces its own result message for the model.
 */
async function executeBatch(
  state: ExecutingState,
  batch: Batch,
  priorEffects: SSEEvent[],
  ctx: AgentContext,
): Promise<TransitionResult> {
  const effects: SSEEvent[] = [...priorEffects];
  const startTimestamp = new Date().toISOString();

  // Fire all start events before kicking off the work
  for (const {call} of batch.calls) {
    effects.push(buildToolCallStartEvent(call, startTimestamp));
  }

  // Run all calls concurrently (pre-exec cache is used per-call inside runToolCall)
  const runs = await Promise.all(
    batch.calls.map(({call, toolDef}) => runToolCall(call, toolDef, ctx)),
  );

  // Emit result events + structured logs in the original order
  for (let i = 0; i < batch.calls.length; i++) {
    const {call} = batch.calls[i];
    const {result, duration, inlineEvents} = runs[i];
    effects.push(...inlineEvents);
    effects.push(buildToolCallResultEvent(call, result, duration));
    ctx.logger.info('tool_call', {
      tool: call.toolName,
      callId: call.toolCallId,
      status: result.status,
      session: ctx.sessionId,
      duration,
    });
  }

  // Apply smart-snipping per result and append each as a tool message in
  // call order, then advance the state. Batched results never individually
  // transition — they collectively advance the state once.
  const snippedResults = runs.map(({result}) => snipIfOversized(result, ctx));
  for (const result of snippedResults) {
    ctx.messages = [...ctx.messages, buildToolResultMessage(result)];
  }
  const allResults = [...state.results, ...snippedResults];

  // More calls pending? Continue in EXECUTING with the next one.
  if (batch.remainingQueue.length > 0) {
    const [next, ...rest] = batch.remainingQueue;
    return {
      next: {type: 'executing', queue: rest, current: next, results: allResults},
      effects,
    };
  }

  // Batch cleared the queue — transition to COMPACTING or THINKING.
  return transitionAfterQueueEmpty(ctx, effects);
}

// ---------------------------------------------------------------------------
// Per-call execution helpers
// ---------------------------------------------------------------------------

/**
 * Execute one tool call (using the pre-exec cache when present), capture
 * duration, and build a ToolResult. Never throws — tool failures become
 * error results the model can observe.
 */
async function runToolCall(
  call: ToolCall,
  toolDef: ToolDefinition,
  ctx: AgentContext,
): Promise<{result: ToolResult; duration: number; inlineEvents: SSEEvent[]}> {
  const startedAt = Date.now();
  try {
    // Check pre-execution cache first (read-only tools started during streaming)
    const cached = ctx.preExecutionCache.get(call.toolCallId);
    let output: unknown;
    let inlineEvents: SSEEvent[] = [];
    if (cached) {
      const cachedResult = await cached;
      // Pre-executed results from streaming return {output, inlineEvents}
      if (cachedResult && typeof cachedResult === 'object' && 'output' in cachedResult) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by 'output' in check above
        const typed = cachedResult as {output: unknown; inlineEvents: SSEEvent[]};
        output = typed.output;
        inlineEvents = typed.inlineEvents;
      } else {
        output = cachedResult;
      }
    } else {
      const execResult = await executeTool(call, toolDef, ctx);
      output = execResult.output;
      inlineEvents = execResult.inlineEvents;
    }

    // Detect structured content blocks from tools that return images
    // (e.g. MCP adapter returns {output: ToolResultContentBlock[]}).
    const content = extractToolContent(output);

    // Detect error-as-result pattern: tool returned {error: "..."} without throwing.
    // This happens when tool internals catch errors and return them as data.
    // Treat these as failures so the SSE event shows status: 'error'.
    const isErrorResult =
      typeof output === 'object' &&
      output !== null &&
      'error' in output &&
      typeof (output as Record<string, unknown>)['error'] === 'string' &&
      Object.keys(output as Record<string, unknown>).length === 1;

    const duration = Date.now() - startedAt;
    if (isErrorResult) {
      ctx.logger.warn('tool_returned_error', {
        tool: call.toolName,
        callId: call.toolCallId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by 'error' in check above
        error: (output as Record<string, unknown>)['error'],
        session: ctx.sessionId,
        duration,
      });
    }
    return {
      result: {
        callId: call.toolCallId,
        toolName: call.toolName,
        status: isErrorResult ? 'error' : 'success',
        content: isErrorResult && typeof content !== 'string' ? contentBlocksToString(content) : content,
      },
      duration,
      inlineEvents,
    };
  } catch (err) {
    const duration = Date.now() - startedAt;
    ctx.logger.error('tool_execution_error', {
      tool: call.toolName,
      callId: call.toolCallId,
      error: err instanceof Error ? err.message : String(err),
      session: ctx.sessionId,
      duration,
    });
    return {
      result: {
        callId: call.toolCallId,
        toolName: call.toolName,
        status: 'error',
        content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      duration,
      inlineEvents: [],
    };
  }
}

function buildToolCallStartEvent(call: ToolCall, timestamp: string): SSEEvent {
  return {
    type: SSEEventType.ToolCallStart,
    tool_name: call.toolName,
    tool_id: call.toolCallId,
    parameters: sanitizeParams(call.args),
    timestamp,
  };
}

/** Max size for tool result content sent via SSE (50KB). */
const MAX_SSE_RESULT_SIZE = 50_000;

function buildToolCallResultEvent(call: ToolCall, result: ToolResult, duration: number): SSEEvent {
  // For structured content (images + text), send as content blocks
  if (result.status === 'success' && Array.isArray(result.content)) {
    return {
      type: SSEEventType.ToolCallResult,
      tool_id: call.toolCallId,
      status: result.status,
      duration_ms: duration,
      content: result.content,
      timestamp: new Date().toISOString(),
    };
  }

  // For plain string results, send truncated text
  let resultField: string | undefined;
  if (result.status === 'success' && typeof result.content === 'string') {
    resultField = result.content.length > MAX_SSE_RESULT_SIZE
      ? result.content.slice(0, MAX_SSE_RESULT_SIZE) + '\n[... truncated]'
      : result.content;
  }

  return {
    type: SSEEventType.ToolCallResult,
    tool_id: call.toolCallId,
    status: result.status,
    duration_ms: duration,
    ...(result.status === 'error' ? {error: typeof result.content === 'string' ? result.content : contentBlocksToString(result.content)} : {}),
    ...(resultField !== undefined ? {result: resultField} : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Execute a tool call, building the ToolContext from the AgentContext.
 * Enforces a timeout via AbortSignal to prevent hanging on broken tools.
 */
export async function executeTool(
  call: ToolCall,
  toolDef: ToolDefinition,
  ctx: AgentContext,
): Promise<{output: unknown; inlineEvents: SSEEvent[]}> {
  const toolCtx = ctx.buildToolContext(call.toolCallId);

  // Combine session abort signal with a per-tool timeout.
  // Mutate instead of spread — toolCtx.request() reads ctx.signal at call
  // time, so the combined signal propagates to HTTP requests and other
  // async operations inside the tool.
  const timeoutSignal = AbortSignal.timeout(ctx.config.toolTimeoutMs);
  toolCtx.signal = AbortSignal.any([ctx.signal, timeoutSignal]);

  const output = await toolDef.execute(call.args, toolCtx);
  const inlineEvents: SSEEvent[] = toolCtx.inlineEvents ? [...toolCtx.inlineEvents] : [];
  return {output, inlineEvents};
}

/**
 * After a tool result: append to messages, then continue to next call or back to THINKING.
 */
export function nextAfterToolResult(
  state: ExecutingState,
  result: ToolResult,
  effects: SSEEvent[],
  ctx: AgentContext,
): TransitionResult {
  const snipped = snipIfOversized(result, ctx);

  // Append tool result message
  const resultMessage = buildToolResultMessage(snipped);
  ctx.messages = [...ctx.messages, resultMessage];

  const allResults = [...state.results, snipped];

  // More tool calls in the queue?
  if (state.queue.length > 0) {
    const [next, ...rest] = state.queue;
    return {
      next: {
        type: 'executing',
        queue: rest,
        current: next,
        results: allResults,
      },
      effects,
    };
  }

  return transitionAfterQueueEmpty(ctx, effects);
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

/**
 * Detect structured content blocks from tool output.
 * MCP adapter returns `{output: ToolResultContentBlock[]}` when images
 * are present, and `{output: string}` otherwise. Other tools return
 * strings or JSON-serializable objects.
 */
/** Regex to detect a data URI with an image MIME type. */
const DATA_URI_RE = /^data:(image\/[a-z+]+);base64,(.+)$/s;

function extractToolContent(output: unknown): string | ToolResultContentBlock[] {
  if (typeof output === 'string') {
    // A bare data URI string → convert to image block
    const m = DATA_URI_RE.exec(output);
    if (m) return [{type: 'image', mimeType: m[1], data: m[2]}];
    return output;
  }

  if (typeof output !== 'object' || output === null) return JSON.stringify(output);

  // Detect structured output from MCP adapter: {output: [...blocks]}
  if ('output' in output) {
    const inner: unknown = output.output;
    if (Array.isArray(inner) && inner.length > 0 && isContentBlockArray(inner)) {
      return inner;
    }
    // {output: "data:image/...;base64,..."} — single image in output field
    if (typeof inner === 'string') {
      const m = DATA_URI_RE.exec(inner);
      if (m) return [{type: 'image', mimeType: m[1], data: m[2]}];
    }
  }

  // {url: "data:image/...;base64,..."} — common pattern from generate_image tools
  if ('url' in output) {
    const url: unknown = output.url;
    if (typeof url === 'string') {
      const m = DATA_URI_RE.exec(url);
      if (m) return [{type: 'image', mimeType: m[1], data: m[2]}];
    }
  }

  return JSON.stringify(output);
}

function hasType(item: unknown): item is {type: string} {
  return typeof item === 'object' && item !== null && 'type' in item && typeof (item as {type: unknown}).type === 'string';
}

function isContentBlockArray(arr: unknown[]): arr is ToolResultContentBlock[] {
  return arr.every((item) =>
    hasType(item) && (item.type === 'text' || item.type === 'image'),
  );
}

// contentBlocksToString imported from loop-types.ts

// ---------------------------------------------------------------------------
// Snipping
// ---------------------------------------------------------------------------

/**
 * Smart snipping: if a tool result exceeds maxResultSize, keep the first
 * and last 2K chars with a [snipped] marker in between. This preserves the
 * beginning (usually headers/structure) and end (usually the answer) while
 * cutting the middle bulk.
 */
function snipIfOversized(result: ToolResult, ctx: AgentContext): ToolResult {
  // Structured content: snip text blocks, cap image blocks by size
  if (Array.isArray(result.content)) {
    return snipStructuredContent({...result, content: result.content}, ctx);
  }

  if (result.content.length <= ctx.config.maxResultSize) return result;
  const originalSize = result.content.length;
  const keepChars = 2_000;
  const head = result.content.slice(0, keepChars);
  const tail = result.content.slice(-keepChars);
  ctx.logger.info('tool_result_snipped', {
    callId: result.callId,
    tool: result.toolName,
    originalSize,
    snippedTo: keepChars * 2,
    session: ctx.sessionId,
  });
  return {
    ...result,
    content: `${head}\n\n[... snipped ${String(originalSize - keepChars * 2)} chars — full output was ${String(originalSize)} chars ...]\n\n${tail}`,
  };
}

function snipStructuredContent(result: ToolResult & {content: ToolResultContentBlock[]}, ctx: AgentContext): ToolResult {
  const blocks = result.content;
  const maxText = ctx.config.maxResultSize;
  const keepChars = 2_000;
  let totalImageSize = 0;

  const snipped: ToolResultContentBlock[] = blocks.map((block) => {
    if (block.type === 'text') {
      if (block.text.length <= maxText) return block;
      const head = block.text.slice(0, keepChars);
      const tail = block.text.slice(-keepChars);
      return {type: 'text' as const, text: `${head}\n\n[... snipped ...]\n\n${tail}`};
    }

    // Image block — enforce per-image and total size caps
    if (block.data.length > MAX_IMAGE_BLOCK_SIZE || totalImageSize + block.data.length > MAX_TOTAL_IMAGE_SIZE) {
      const sizeMB = (block.data.length / 1024 / 1024).toFixed(1);
      ctx.logger.info('tool_result_image_dropped', {
        callId: result.callId,
        tool: result.toolName,
        mimeType: block.mimeType,
        sizeMB,
        session: ctx.sessionId,
      });
      return {type: 'text' as const, text: `[image too large: ${block.mimeType}, ${sizeMB}MB]`};
    }
    totalImageSize += block.data.length;
    return block;
  });

  return {...result, content: snipped};
}

/**
 * Transition after the tool-call queue is drained — either COMPACTING if
 * context is heavy, or THINKING for the next LLM turn.
 */
function transitionAfterQueueEmpty(ctx: AgentContext, effects: SSEEvent[]): TransitionResult {
  const estimatedTokens = estimateTokenCount(ctx.messages, ctx.provider);
  if (estimatedTokens > ctx.maxContextTokens * ctx.config.compactThreshold) {
    ctx.logger.info('context_compaction_triggered', {
      session: ctx.sessionId,
      estimatedTokens,
      maxContextTokens: ctx.maxContextTokens,
      threshold: ctx.config.compactThreshold,
    });
    return {
      next: {type: 'compacting', messages: ctx.messages, estimatedTokens},
      effects,
    };
  }
  return {
    next: {type: 'thinking', messages: ctx.messages},
    effects,
  };
}

/**
 * Build a tool result message in AI SDK format.
 */
function buildToolResultMessage(result: ToolResult): ModelMessage {
  // AI SDK expects text content — convert structured blocks to string for LLM context
  const textValue = typeof result.content === 'string'
    ? result.content
    : contentBlocksToString(result.content);

  return {
    role: 'tool',
    content: [{
      type: 'tool-result' as const,
      toolCallId: result.callId,
      toolName: result.toolName,
      output: {type: 'text' as const, value: textValue},
    }],
  };
}

/**
 * Strip sensitive fields from tool call parameters for SSE events.
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

