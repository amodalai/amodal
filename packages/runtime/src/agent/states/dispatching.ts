/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DISPATCHING state handler (Phase 3.6).
 *
 * Spawns a child agent with a subset of tools and a specific prompt.
 * The child runs its own runAgent() loop; each child event is wrapped
 * as an SSESubagentEvent and yielded as an effect so the client can
 * display real-time sub-agent activity.
 *
 * After the child completes, the handler builds a ToolResult from the
 * child's text response and transitions back through the normal
 * EXECUTING post-result flow (queue, compaction, thinking).
 */

import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import {createToolRegistry} from '../../tools/registry.js';
import {DEFAULT_LOOP_CONFIG} from '../loop-types.js';
import type {
  DispatchingState,
  AgentContext,
  TransitionResult,
  ToolResult,
} from '../loop-types.js';
import {runAgent} from '../loop.js';
import {nextAfterToolResult} from './executing.js';
import {DEFAULT_CHILD_MAX_TURNS, DISPATCH_TOOL_NAME} from '../../tools/dispatch-tool.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHILD_MAX_CONTEXT_TOKENS = 100_000;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle the DISPATCHING state — run a child agent loop.
 *
 * Creates a child AgentContext with:
 * - Same provider, logger, signal, tenant, user, permission checker
 * - Tool registry subset (only the requested tools, never dispatch_task)
 * - Same buildToolContext factory (child shares parent's connections/stores)
 * - Reduced maxTurns (default 10) and maxContextTokens
 * - Fresh messages (dispatch prompt as user message)
 * - Fresh usage counters (merged back to parent after completion)
 */
export async function handleDispatching(
  state: DispatchingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  const {task, toolCallId} = state;
  const effects: SSEEvent[] = [];
  const startedAt = Date.now();

  ctx.logger.info('dispatch_start', {
    session: ctx.sessionId,
    agent: task.agentName,
    tools: task.toolSubset,
    maxTurns: task.maxTurns ?? DEFAULT_CHILD_MAX_TURNS,
    parentToolCallId: toolCallId,
  });

  // Build child tool registry from the parent's subset
  const childRegistry = createToolRegistry();
  const subsetTools = ctx.toolRegistry.subset(task.toolSubset);
  for (const [name, def] of Object.entries(subsetTools)) {
    childRegistry.register(name, def);
  }

  // Build child context
  const childCtx: AgentContext = {
    provider: ctx.provider,
    toolRegistry: childRegistry,
    permissionChecker: ctx.permissionChecker,
    logger: ctx.logger,
    signal: ctx.signal,
    sessionId: ctx.sessionId,
    tenantId: ctx.tenantId,
    user: ctx.user,
    systemPrompt: ctx.systemPrompt,
    messages: [],
    usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
    turnCount: 0,
    maxTurns: task.maxTurns ?? DEFAULT_CHILD_MAX_TURNS,
    maxContextTokens: task.maxContextTokens ?? DEFAULT_CHILD_MAX_CONTEXT_TOKENS,
    config: {...DEFAULT_LOOP_CONFIG},
    compactionFailures: 0,
    preExecutionCache: new Map(),
    waitForConfirmation: ctx.waitForConfirmation,
    buildToolContext: ctx.buildToolContext,
  };

  // Run child agent loop and translate events to SubagentEvents
  let childResponse = '';
  let childFailed = false;

  try {
    for await (const childEvent of runAgent({messages: [{role: 'user', content: task.prompt}], context: childCtx})) {
      if (ctx.signal.aborted) break;

      // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- intentionally skip child-internal events (Init, Widget, etc.)
      switch (childEvent.type) {
        case SSEEventType.TextDelta:
          childResponse += childEvent.content;
          effects.push({
            type: SSEEventType.SubagentEvent,
            parent_tool_id: toolCallId,
            agent_name: task.agentName,
            event_type: 'thought',
            text: childEvent.content,
            timestamp: childEvent.timestamp,
          });
          break;

        case SSEEventType.ToolCallStart:
          effects.push({
            type: SSEEventType.SubagentEvent,
            parent_tool_id: toolCallId,
            agent_name: task.agentName,
            event_type: 'tool_call_start',
            tool_name: childEvent.tool_name,
            tool_args: childEvent.parameters,
            timestamp: childEvent.timestamp,
          });
          break;

        case SSEEventType.ToolCallResult:
          effects.push({
            type: SSEEventType.SubagentEvent,
            parent_tool_id: toolCallId,
            agent_name: task.agentName,
            event_type: 'tool_call_end',
            tool_name: undefined,
            result: childEvent.status === 'error' ? childEvent.error : undefined,
            timestamp: childEvent.timestamp,
          });
          break;

        case SSEEventType.Error:
          effects.push({
            type: SSEEventType.SubagentEvent,
            parent_tool_id: toolCallId,
            agent_name: task.agentName,
            event_type: 'error',
            error: childEvent.message,
            timestamp: childEvent.timestamp,
          });
          break;

        case SSEEventType.Done:
          effects.push({
            type: SSEEventType.SubagentEvent,
            parent_tool_id: toolCallId,
            agent_name: task.agentName,
            event_type: 'complete',
            timestamp: childEvent.timestamp,
          });
          break;

        default:
          // Skip Init and other events — they're child-internal
          break;
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ctx.logger.error('dispatch_child_error', {
      session: ctx.sessionId,
      agent: task.agentName,
      error: errorMessage,
      parentToolCallId: toolCallId,
    });

    effects.push({
      type: SSEEventType.SubagentEvent,
      parent_tool_id: toolCallId,
      agent_name: task.agentName,
      event_type: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    childResponse = `Sub-agent "${task.agentName}" failed: ${errorMessage}`;
    childFailed = true;
  }

  // Merge child usage into parent
  ctx.usage.inputTokens += childCtx.usage.inputTokens;
  ctx.usage.outputTokens += childCtx.usage.outputTokens;
  ctx.usage.totalTokens += childCtx.usage.totalTokens;
  if (childCtx.usage.cachedInputTokens) {
    ctx.usage.cachedInputTokens = (ctx.usage.cachedInputTokens ?? 0) + childCtx.usage.cachedInputTokens;
  }
  if (childCtx.usage.cacheCreationInputTokens) {
    ctx.usage.cacheCreationInputTokens = (ctx.usage.cacheCreationInputTokens ?? 0) + childCtx.usage.cacheCreationInputTokens;
  }

  const duration = Date.now() - startedAt;

  ctx.logger.info('dispatch_complete', {
    session: ctx.sessionId,
    agent: task.agentName,
    childTurns: childCtx.turnCount,
    childUsage: childCtx.usage,
    responseLength: childResponse.length,
    parentToolCallId: toolCallId,
    duration,
  });

  // Build tool result from child response
  const result: ToolResult = {
    callId: toolCallId,
    toolName: DISPATCH_TOOL_NAME,
    status: childFailed ? 'error' : 'success',
    content: childResponse || '(no response from sub-agent)',
  };

  // Emit ToolCallResult for the dispatch_task call
  effects.push({
    type: SSEEventType.ToolCallResult,
    tool_id: toolCallId,
    status: result.status,
    duration_ms: duration,
    ...(result.status === 'error' ? {error: result.content} : {}),
    timestamp: new Date().toISOString(),
  });

  // Use the shared post-result transition logic from EXECUTING.
  // This handles: append tool result message, continue queue, compaction check.
  const executingState = {
    type: 'executing' as const,
    current: {toolCallId, toolName: DISPATCH_TOOL_NAME, args: {}},
    queue: state.queue,
    results: state.results,
  };

  return nextAfterToolResult(executingState, result, effects, ctx);
}
