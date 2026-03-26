/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { z } from 'zod';
import type { SessionManager } from '../session/session-manager.js';

const WidgetActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('credential_saved'),
    connection_name: z.string().min(1),
  }),
  z.object({
    action: z.literal('approved'),
    resource_type: z.string().min(1),
    preview_id: z.string().min(1),
  }),
]);

export type WidgetAction = z.infer<typeof WidgetActionSchema>;

export interface WidgetActionsRouterOptions {
  sessionManager: SessionManager;
}

/**
 * Construct the synthetic user message for a widget action.
 * The chat widget sends this as a follow-up user message so the
 * agent knows the user acted on the widget.
 */
export function buildSyntheticMessage(action: WidgetAction): string {
  if (action.action === 'credential_saved') {
    return `Credentials for ${action.connection_name} have been saved.`;
  }
  return `I've approved the ${action.resource_type} '${action.preview_id}'.`;
}

/**
 * POST /chat/sessions/:session_id/widget-action
 *
 * Accepts user actions from input widgets (credential-input, document-preview).
 * Validates the action and returns a synthetic message that the chat widget
 * should send as a follow-up user message.
 */
export function createWidgetActionsRouter(
  options: WidgetActionsRouterOptions,
): Router {
  const router = Router();

  router.post(
    '/chat/sessions/:session_id/widget-action',
    (req, res, next) => {
      try {
        const sessionId = req.params['session_id'];
        if (!sessionId) {
          res.status(400).json({
            error: { code: 'MISSING_SESSION_ID', message: 'session_id is required' },
          });
          return;
        }

        const parsed = WidgetActionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'INVALID_ACTION',
              message: parsed.error.errors.map((e) => e.message).join(', '),
            },
          });
          return;
        }

        // Verify session exists
        const session = options.sessionManager.get(sessionId);
        if (!session) {
          res.status(404).json({
            error: { code: 'SESSION_NOT_FOUND', message: `Session '${sessionId}' not found` },
          });
          return;
        }

        const syntheticMessage = buildSyntheticMessage(parsed.data);

        res.json({
          ok: true,
          message: syntheticMessage,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
