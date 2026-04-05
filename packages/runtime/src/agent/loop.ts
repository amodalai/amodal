/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent Loop (State Machine Core)
 *
 * The outer `runAgent()` async generator drives state transitions and
 * yields SSE events. Each state handler returns the next state plus
 * a list of effects (SSE events) to emit.
 *
 * The loop is transport-agnostic — the caller (HTTP route, automation
 * runner, eval runner) iterates over it and decides what to do with
 * the events.
 */

import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import type {
  AgentState,
  AgentContext,
  TransitionResult,
  RunAgentOptions,
} from './loop-types.js';
import {handleThinking} from './states/thinking.js';
import {handleStreaming} from './states/streaming.js';
import {handleExecuting} from './states/executing.js';
import {handleConfirming} from './states/confirming.js';
import {handleCompacting} from './states/compacting.js';
import {handleDispatching} from './states/dispatching.js';

// ---------------------------------------------------------------------------
// Transition dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch to the appropriate state handler based on the current state.
 *
 * Uses exhaustive switch with `never` check so adding a new state
 * variant causes a compile error, not a silent fallthrough.
 */
export async function transition(
  state: AgentState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  switch (state.type) {
    case 'thinking':
      return handleThinking(state, ctx);

    case 'streaming':
      return handleStreaming(state, ctx);

    case 'executing':
      return handleExecuting(state, ctx);

    case 'confirming':
      return handleConfirming(state, ctx);

    case 'compacting':
      return handleCompacting(state, ctx);

    case 'dispatching':
      return handleDispatching(state, ctx);

    case 'done':
      // Should never be called with 'done' state — the loop exits before this
      return {next: state, effects: []};

    default: {
      const _exhaustive: never = state;
      throw new Error(`Unhandled agent state: ${(_exhaustive as AgentState).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop as an async generator yielding SSE events.
 *
 * The generator:
 * 1. Emits an `init` event
 * 2. Transitions through states until `done`
 * 3. Checks abort signal and turn budget between transitions
 * 4. Emits a `done` event with token usage
 *
 * Usage:
 * ```typescript
 * for await (const event of runAgent({ messages, context })) {
 *   sendSSE(event);
 * }
 * ```
 */
export async function* runAgent(
  options: RunAgentOptions,
): AsyncGenerator<SSEEvent> {
  const {messages, context: ctx} = options;

  // Emit init event
  yield {
    type: SSEEventType.Init,
    session_id: ctx.sessionId,
    timestamp: new Date().toISOString(),
  };

  let state: AgentState = {type: 'thinking', messages};

  ctx.logger.info('agent_loop_start', {
    session: ctx.sessionId,
    tenant: ctx.tenantId,
    maxTurns: ctx.maxTurns,
    messageCount: messages.length,
  });

  while (state.type !== 'done') {
    const result = await transition(state, ctx);

    // Yield all effects (SSE events) to the caller
    for (const event of result.effects) {
      yield event;
    }

    // Check abort between every state transition
    if (ctx.signal.aborted) {
      ctx.logger.info('agent_loop_aborted', {
        session: ctx.sessionId,
        turn: ctx.turnCount,
        previousState: state.type,
      });
      state = {type: 'done', usage: {...ctx.usage}, reason: 'user_abort'};
      continue;
    }

    // Check turn budget
    if (ctx.turnCount >= ctx.maxTurns && result.next.type !== 'done') {
      ctx.logger.warn('agent_loop_max_turns', {
        session: ctx.sessionId,
        turnCount: ctx.turnCount,
        maxTurns: ctx.maxTurns,
      });
      state = {type: 'done', usage: {...ctx.usage}, reason: 'max_turns'};
      continue;
    }

    // Check token budget — closes the silent-cost-runaway hole where a long-
    // running automation could burn through a large budget in a tight retry
    // loop. Undefined maxSessionTokens means no cap (existing behavior).
    if (
      ctx.maxSessionTokens !== undefined &&
      ctx.usage.totalTokens >= ctx.maxSessionTokens &&
      result.next.type !== 'done'
    ) {
      ctx.logger.info('agent_loop_budget_exceeded', {
        session: ctx.sessionId,
        turnCount: ctx.turnCount,
        totalTokens: ctx.usage.totalTokens,
        maxSessionTokens: ctx.maxSessionTokens,
      });
      state = {type: 'done', usage: {...ctx.usage}, reason: 'budget_exceeded'};
      continue;
    }

    state = result.next;
  }

  // Emit done event with usage — always, regardless of done reason
  ctx.logger.info('agent_loop_done', {
    session: ctx.sessionId,
    tenant: ctx.tenantId,
    reason: state.reason,
    turns: ctx.turnCount,
    usage: ctx.usage,
  });

  yield {
    type: SSEEventType.Done,
    timestamp: new Date().toISOString(),
    reason: state.reason,
    usage: {
      input_tokens: ctx.usage.inputTokens,
      output_tokens: ctx.usage.outputTokens,
      cached_tokens: ctx.usage.cachedInputTokens ?? 0,
      cache_creation_tokens: ctx.usage.cacheCreationInputTokens ?? 0,
      total_tokens: ctx.usage.totalTokens,
    },
  };
}
