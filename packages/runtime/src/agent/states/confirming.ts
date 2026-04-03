/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * CONFIRMING state handler.
 *
 * Waits for user confirmation on a tool call (via ctx.waitForConfirmation).
 * - Approved → resume EXECUTING with the confirmed call
 * - Denied → tell the model the tool call was denied, back to THINKING
 */

import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import type {
  ConfirmingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';

/**
 * Handle the CONFIRMING state.
 */
export async function handleConfirming(
  state: ConfirmingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  const effects: SSEEvent[] = [];

  ctx.logger.info('tool_confirmation_waiting', {
    tool: state.call.toolName,
    callId: state.call.toolCallId,
    session: ctx.sessionId,
  });

  const approved = await ctx.waitForConfirmation(state.call.toolCallId);

  if (approved) {
    ctx.logger.info('tool_confirmation_approved', {
      tool: state.call.toolName,
      callId: state.call.toolCallId,
      session: ctx.sessionId,
    });

    effects.push({
      type: SSEEventType.Approved,
      resource_type: 'tool_call',
      preview_id: state.call.toolCallId,
      timestamp: new Date().toISOString(),
    });

    return {
      next: {
        type: 'executing',
        queue: state.remainingQueue,
        current: state.call,
        results: [],
      },
      effects,
    };
  }

  // Denied — inject a tool result message telling the model
  ctx.logger.info('tool_confirmation_denied', {
    tool: state.call.toolName,
    callId: state.call.toolCallId,
    session: ctx.sessionId,
  });

  const denialMessage: import('ai').ModelMessage = {
    role: 'tool',
    content: [{
      type: 'tool-result' as const,
      toolCallId: state.call.toolCallId,
      toolName: state.call.toolName,
      output: {type: 'text' as const, value: 'Tool call denied by user. Do not retry this action without asking the user first.'},
    }],
  };

  ctx.messages = [...ctx.messages, denialMessage];

  return {
    next: {type: 'thinking', messages: ctx.messages},
    effects,
  };
}
