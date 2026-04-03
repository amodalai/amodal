/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * COMPACTING state handler (stub).
 *
 * Full implementation comes in Phase 3.3. For now, this is a pass-through
 * that transitions back to THINKING without modifying messages.
 *
 * The full implementation will:
 * 1. Use generateText() to summarize old conversation turns
 * 2. Replace old turns with the summary
 * 3. Have a circuit breaker (3 failures → give up, continue)
 */

import type {
  CompactingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';

/**
 * Handle the COMPACTING state.
 *
 * Stub: transitions directly to THINKING with unchanged messages.
 */
export async function handleCompacting(
  state: CompactingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  ctx.logger.debug('compacting_skipped', {
    session: ctx.sessionId,
    reason: 'stub_implementation',
  });

  return {
    next: {type: 'thinking', messages: state.messages},
    effects: [],
  };
}
