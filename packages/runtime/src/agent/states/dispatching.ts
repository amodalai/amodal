/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DISPATCHING state handler.
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
const DEFAULT_CHILD_TIMEOUT_MS = 60_000;

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

  // Short-circuit: if the parent is already out of budget, don't bother
  // spinning up a child only to have it run one doomed turn. The child
  // would inherit maxSessionTokens=0, burn through its first streaming
  // call, and stop on budget_exceeded anyway. Surface a clean error
  // result to the parent instead.
  if (
    ctx.maxSessionTokens !== undefined &&
    ctx.usage.totalTokens >= ctx.maxSessionTokens
  ) {
    ctx.logger.warn('dispatch_skipped_budget_exhausted', {
      session: ctx.sessionId,
      agent: task.agentName,
      totalTokens: ctx.usage.totalTokens,
      maxSessionTokens: ctx.maxSessionTokens,
      parentToolCallId: toolCallId,
    });
    const result: ToolResult = {
      callId: toolCallId,
      toolName: DISPATCH_TOOL_NAME,
      status: 'error',
      content: `Sub-agent dispatch skipped: session token budget (${ctx.maxSessionTokens}) already reached.`,
    };
    effects.push({
      type: SSEEventType.ToolCallResult,
      tool_id: toolCallId,
      status: result.status,
      duration_ms: Date.now() - startedAt,
      error: typeof result.content === 'string' ? result.content : undefined,
      timestamp: new Date().toISOString(),
    });
    const executingState = {
      type: 'executing' as const,
      current: {toolCallId, toolName: DISPATCH_TOOL_NAME, args: {}},
      queue: state.queue,
      results: state.results,
    };
    return nextAfterToolResult(executingState, result, effects, ctx);
  }

  // Build child tool registry from the parent's subset
  const childRegistry = createToolRegistry();
  const subsetTools = ctx.toolRegistry.subset(task.toolSubset);
  for (const [name, def] of Object.entries(subsetTools)) {
    childRegistry.register(name, def);
  }

  // Child-specific timeout — prevents a slow child from starving the parent.
  // Combined with parent's signal so parent abort also stops child.
  const childTimeoutMs = task.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;
  const childSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(childTimeoutMs)]);

  // Minimal system prompt for the child — the full parent prompt (skills,
  // knowledge, connection docs) is unnecessary for a focused sub-task and
  // wastes tokens. The child gets a task-scoped prompt with available tools.
  const childToolNames = childRegistry.names();
  const childSystemPrompt = buildChildSystemPrompt(task.agentName, task.prompt, childToolNames);

  // Build child context
  const childCtx: AgentContext = {
    provider: ctx.provider,
    toolRegistry: childRegistry,
    permissionChecker: ctx.permissionChecker,
    logger: ctx.logger,
    signal: childSignal,
    sessionId: ctx.sessionId,
    systemPrompt: childSystemPrompt,
    messages: [],
    usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
    turnCount: 0,
    maxTurns: task.maxTurns ?? DEFAULT_CHILD_MAX_TURNS,
    maxContextTokens: task.maxContextTokens ?? DEFAULT_CHILD_MAX_CONTEXT_TOKENS,
    // Propagate parent's remaining token budget so a child can't blow through
    // more than the parent had left. Child usage merges back into parent after
    // the child completes, so the parent's next budget check catches any
    // overshoot on subsequent turns regardless.
    maxSessionTokens: ctx.maxSessionTokens !== undefined
      ? Math.max(0, ctx.maxSessionTokens - ctx.usage.totalTokens)
      : undefined,
    config: {...DEFAULT_LOOP_CONFIG},
    compactionFailures: 0,
    preExecutionCache: new Map(),
    confirmedCallIds: new Set(),
    disabledToolsUntilTurn: new Map(),
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
    ...(result.status === 'error' ? {error: typeof result.content === 'string' ? result.content : undefined} : {}),
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

// ---------------------------------------------------------------------------
// Child system prompt
// ---------------------------------------------------------------------------

/**
 * Build a minimal system prompt for the child agent.
 *
 * The full parent prompt (30K+ chars of skills, knowledge, connection docs)
 * is wasteful for a focused sub-task. The child gets a concise, task-scoped
 * prompt listing only its available tools.
 */
function buildChildSystemPrompt(agentName: string, taskPrompt: string, toolNames: string[]): string {
  const toolList = toolNames.length > 0
    ? `\n\nAvailable tools: ${toolNames.join(', ')}`
    : '';

  return `You are "${agentName}", a sub-agent executing a delegated task. Complete the task and return a concise summary of your findings or actions.

Do not ask clarifying questions — work with what you have. If you cannot complete the task, explain what went wrong.${toolList}`;
}
