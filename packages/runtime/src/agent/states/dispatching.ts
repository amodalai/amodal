/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DISPATCHING state handler (stub).
 *
 * Full implementation comes in a later phase. This state handles
 * sub-agent dispatch — spinning up a child agent with a subset
 * of tools and a specific prompt.
 *
 * For now, transitions to DONE with an error since sub-agent
 * dispatch is not yet implemented.
 */

import {SSEEventType} from '../../types.js';
import type {
  DispatchingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';

/**
 * Handle the DISPATCHING state.
 *
 * Stub: transitions to DONE with an error.
 */
export async function handleDispatching(
  state: DispatchingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  ctx.logger.warn('dispatching_not_implemented', {
    session: ctx.sessionId,
    agent: state.task.agentName,
  });

  return {
    next: {type: 'done', usage: {...ctx.usage}, reason: 'error'},
    effects: [{
      type: SSEEventType.Error,
      message: `Sub-agent dispatch is not yet implemented (target: ${state.task.agentName})`,
      timestamp: new Date().toISOString(),
    }],
  };
}
