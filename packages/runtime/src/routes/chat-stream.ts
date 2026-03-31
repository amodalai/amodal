/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { ChatRequestSchema, SSEEventType } from '../types.js';
import { validate } from '../middleware/request-validation.js';
import { getAuthContext } from '../middleware/auth.js';
import type { SessionManager } from '../session/session-manager.js';
import { streamMessage, type StreamAuditContext } from '../session/session-runner.js';
import type { AuditClient } from '../audit/audit-client.js';

export interface ChatStreamRouterOptions {
  sessionManager: SessionManager;
  auditClient?: AuditClient;
  platformApiUrl?: string;
}

export function createChatStreamRouter(
  options: ChatStreamRouterOptions,
): Router {
  const router = Router();

  router.post(
    '/chat/stream',
    validate(ChatRequestSchema),
    async (req, res, next) => {
      try {
        const { message, session_id, role, session_type, deploy_id } = req.body;

        let session;
        if (session_id) {
          session = options.sessionManager.get(session_id);
          if (!session) {
            // Try hydrating from stored conversation history
            const auth = getAuthContext(res);
            session = await options.sessionManager.hydrate(session_id, role, auth, session_type);
          }
          if (!session) {
            // History not found — create fresh session
            const auth = getAuthContext(res);
            session = await options.sessionManager.create(role, auth, session_type, undefined, deploy_id);
          }
        } else {
          const auth = getAuthContext(res);
          session = await options.sessionManager.create(role, auth, session_type, undefined, deploy_id);
        }

        // Set up SSE headers (use setHeader to preserve CORS headers from middleware)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const controller = new AbortController();

        // Abort on client disconnect
        res.on('close', () => controller.abort());

        // Build audit context if audit client is available
        let audit: StreamAuditContext | undefined;
        if (options.auditClient) {
          const auth = getAuthContext(res);
          if (auth?.token && auth.applicationId) {
            audit = {
              auditClient: options.auditClient,
              appId: auth.applicationId,
              token: auth.token,
              orgId: auth.orgId,
              actor: auth.actor,
              platformApiUrl: options.platformApiUrl,
            };
          }
        }

        const stream = streamMessage(session, message, controller.signal, audit, options.sessionManager);

        for await (const event of stream) {
          if (controller.signal.aborted) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        res.end();
      } catch (err) {
        // If headers already sent (SSE started), write error as SSE event
        if (res.headersSent) {
          const errorEvent = {
            type: SSEEventType.Error,
            message: err instanceof Error ? err.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          };
          res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          res.end();
        } else {
          next(err);
        }
      }
    },
  );

  return router;
}
