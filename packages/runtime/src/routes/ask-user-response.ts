/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { z } from 'zod';
import type { SessionManager } from '../session/session-manager.js';

const AskUserResponseSchema = z.object({
  ask_id: z.string().min(1),
  answers: z.record(z.string()),
});

export type AskUserResponseBody = z.infer<typeof AskUserResponseSchema>;

export interface AskUserResponseRouterOptions {
  sessionManager: SessionManager;
}

/**
 * POST /chat/sessions/:session_id/ask-user-response
 *
 * Accepts user answers to an ask_user prompt. Resolves the pending
 * deferred promise in the session so the stream can continue.
 */
export function createAskUserResponseRouter(
  options: AskUserResponseRouterOptions,
): Router {
  const router = Router();

  router.post(
    '/chat/sessions/:session_id/ask-user-response',
    (req, res, next) => {
      try {
        const sessionId = req.params['session_id'];
        if (!sessionId) {
          res.status(400).json({
            error: { code: 'MISSING_SESSION_ID', message: 'session_id is required' },
          });
          return;
        }

        const parsed = AskUserResponseSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'INVALID_BODY',
              message: parsed.error.errors.map((e) => e.message).join(', '),
            },
          });
          return;
        }

        const session = options.sessionManager.get(sessionId);
        if (!session) {
          res.status(404).json({
            error: { code: 'SESSION_NOT_FOUND', message: `Session '${sessionId}' not found` },
          });
          return;
        }

        const resolved = options.sessionManager.resolveAskUser(
          session,
          parsed.data.ask_id,
          parsed.data.answers,
        );

        if (!resolved) {
          res.status(404).json({
            error: { code: 'ASK_NOT_FOUND', message: `No pending ask_user with id '${parsed.data.ask_id}'` },
          });
          return;
        }

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
