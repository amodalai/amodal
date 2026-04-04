/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * EXECUTING state handler.
 *
 * Runs one tool call at a time:
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
} from '../loop-types.js';
import {estimateTokenCount} from '../token-estimate.js';

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

  // 3. Check permissions
  //    Currently scoped to connection tools only — they have access.json ACLs
  //    with endpoint-level allow/deny/confirm rules. Store tools and admin tools
  //    have their own guards (read-only paths, blocked filenames, schema validation).
  //    A general confirmation gate for all non-readOnly tools is planned for Phase 3.4
  //    when the session manager wires up the full confirmation flow.
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

    if (permResult.allowed && permResult.requiresConfirmation) {
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

  // 4. Execute the tool
  effects.push({
    type: SSEEventType.ToolCallStart,
    tool_name: current.toolName,
    tool_id: current.toolCallId,
    parameters: sanitizeParams(current.args),
    timestamp,
  });

  const startedAt = Date.now();
  let result: ToolResult;

  try {
    // Check pre-execution cache first (read-only tools started during streaming)
    const cached = ctx.preExecutionCache.get(current.toolCallId);
    const output = cached
      ? await cached
      : await executeTool(current, toolDef, ctx);

    const content = typeof output === 'string' ? output : JSON.stringify(output);
    result = {
      callId: current.toolCallId,
      toolName: current.toolName,
      status: 'success',
      content,
    };
  } catch (err) {
    // Tool execution failed — don't crash the loop, tell the model what happened
    result = {
      callId: current.toolCallId,
      toolName: current.toolName,
      status: 'error',
      content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
    ctx.logger.error('tool_execution_error', {
      tool: current.toolName,
      callId: current.toolCallId,
      error: err instanceof Error ? err.message : String(err),
      session: ctx.sessionId,
      tenant: ctx.tenantId,
      duration: Date.now() - startedAt,
    });
  }

  const duration = Date.now() - startedAt;
  effects.push({
    type: SSEEventType.ToolCallResult,
    tool_id: current.toolCallId,
    status: result.status,
    duration_ms: duration,
    ...(result.status === 'error' ? {error: result.content} : {}),
    timestamp: new Date().toISOString(),
  });

  ctx.logger.info('tool_call', {
    tool: current.toolName,
    callId: current.toolCallId,
    status: result.status,
    session: ctx.sessionId,
    tenant: ctx.tenantId,
    duration,
  });

  return nextAfterToolResult(state, result, effects, ctx);
}

/**
 * Execute a tool call, building the ToolContext from the AgentContext.
 * Enforces a timeout via AbortSignal to prevent hanging on broken tools.
 */
export async function executeTool(
  call: ToolCall,
  toolDef: ToolDefinition,
  ctx: AgentContext,
): Promise<unknown> {
  const toolCtx = ctx.buildToolContext(call.toolCallId);

  // Combine session abort signal with a per-tool timeout.
  // Mutate instead of spread — toolCtx.request() reads ctx.signal at call
  // time, so the combined signal propagates to HTTP requests and other
  // async operations inside the tool.
  const timeoutSignal = AbortSignal.timeout(ctx.config.toolTimeoutMs);
  toolCtx.signal = AbortSignal.any([ctx.signal, timeoutSignal]);

  return toolDef.execute(call.args, toolCtx);
}

/**
 * After a tool result: append to messages, then continue to next call or back to THINKING.
 */
function nextAfterToolResult(
  state: ExecutingState,
  result: ToolResult,
  effects: SSEEvent[],
  ctx: AgentContext,
): TransitionResult {
  // Smart snipping: if a tool result exceeds maxResultSize, keep the first
  // and last 2K chars with a [snipped] marker in between. This preserves
  // the beginning (usually headers/structure) and end (usually the answer)
  // while cutting the middle bulk.
  if (result.content.length > ctx.config.maxResultSize) {
    const originalSize = result.content.length;
    const keepChars = 2_000;
    const head = result.content.slice(0, keepChars);
    const tail = result.content.slice(-keepChars);
    result = {
      ...result,
      content: `${head}\n\n[... snipped ${originalSize - keepChars * 2} chars — full output was ${originalSize} chars ...]\n\n${tail}`,
    };
    ctx.logger.info('tool_result_snipped', {
      callId: result.callId,
      tool: result.toolName,
      originalSize,
      snippedTo: keepChars * 2,
      session: ctx.sessionId,
    });
  }

  // Append tool result message
  const resultMessage = buildToolResultMessage(result);
  ctx.messages = [...ctx.messages, resultMessage];

  const allResults = [...state.results, result];

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

  // All tool calls done — check if context is heavy enough to compact
  const estimatedTokens = estimateTokenCount(ctx.messages);
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

  // Context OK — back to THINKING for the next LLM turn
  return {
    next: {type: 'thinking', messages: ctx.messages},
    effects,
  };
}

/**
 * Build a tool result message in AI SDK format.
 */
function buildToolResultMessage(result: ToolResult): ModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result' as const,
      toolCallId: result.callId,
      toolName: result.toolName,
      output: {type: 'text' as const, value: result.content},
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

