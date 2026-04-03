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

  // 2. Check permissions
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

  // 3. Execute the tool
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
 */
export async function executeTool(
  call: ToolCall,
  toolDef: ToolDefinition,
  ctx: AgentContext,
): Promise<unknown> {
  const toolCtx = ctx.buildToolContext(call.toolCallId);
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
  // Append tool result message
  const resultMessage = buildToolResultMessage(result);
  ctx.messages = [...ctx.messages, resultMessage];

  // Flag oversized tool output (actual snipping implemented in Phase 3.3)
  if (result.content.length > ctx.config.maxResultSize) {
    ctx.logger.debug('tool_result_oversized', {
      callId: result.callId,
      tool: result.toolName,
      originalSize: result.content.length,
      maxSize: ctx.config.maxResultSize,
    });
  }

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

  // All tool calls done — back to THINKING for the next LLM turn
  return {
    next: {type: 'thinking', messages: ctx.messages},
    effects,
  };
}

/**
 * Build a tool result message in AI SDK format.
 */
function buildToolResultMessage(result: ToolResult): import('ai').ModelMessage {
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
