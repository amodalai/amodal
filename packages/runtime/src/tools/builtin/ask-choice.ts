/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `ask_choice` — runtime built-in tool that emits a single- or
 * multi-select question rendered inline in chat as a row of buttons.
 *
 * Promoted from `registerAdminTools` to a runtime built-in (Phase 0.6)
 * so every agent gets it automatically without needing to declare a
 * custom tool. Templates and custom agents can use the same primitive
 * to ask the user a structured question with concrete options — no
 * need to reinvent button-based prompts per agent package.
 *
 * The tool emits the existing `ask_choice` SSE event so the chat
 * widget's existing renderer keeps working unchanged.
 */

import {z} from 'zod';

import {SSEEventType} from '../../types.js';
import type {ToolContext, ToolDefinition} from '../types.js';

export const ASK_CHOICE_TOOL_NAME = 'ask_choice';

export function createAskChoiceTool(): ToolDefinition {
  return {
    description:
      "Ask the user a single- or multi-select question with predefined options. Renders inline as buttons; the user's choice arrives as their next message.",
    parameters: z.object({
      question: z.string().describe('Short question shown above the buttons'),
      options: z
        .array(z.object({label: z.string(), value: z.string()}))
        .min(2)
        .describe(
          'Choice options. `label` is shown on the button; `value` is what the user "says".',
        ),
      multi: z
        .boolean()
        .default(false)
        .describe('When true, the user can pick more than one option before submitting'),
    }),
    readOnly: true,
    metadata: {category: 'system'},
    runningLabel: 'Asking: {{question}}',
    completedLabel: 'Asked: {{question}}',

    async execute(
      params: {question: string; options: Array<{label: string; value: string}>; multi: boolean},
      ctx: ToolContext,
    ) {
      const askId = `choice_${ctx.sessionId}_${Date.now().toString(36)}`;
      ctx.emit?.({
        type: SSEEventType.AskChoice,
        ask_id: askId,
        question: params.question,
        options: params.options,
        multi: params.multi,
        timestamp: new Date().toISOString(),
      });
      return {ok: true, ask_id: askId};
    },
  };
}
