/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { ChatRequestSchema } from '../types.js';
import { validate } from '../middleware/request-validation.js';
import { AppError } from '../middleware/error-handler.js';
import { getAuthContext } from '../middleware/auth.js';
import type { SessionManager } from '../session/session-manager.js';
import { runMessage, type StreamAuditContext } from '../session/session-runner.js';
import type { AuditClient } from '../audit/audit-client.js';

export interface ChatRouterOptions {
  sessionManager: SessionManager;
  auditClient?: AuditClient;
}

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  router.post('/chat', validate(ChatRequestSchema), async (req, res, next) => {
    try {
      const { message, session_id, role, deploy_id } = req.body;

      // Get or create session
      let session;
      if (session_id) {
        session = options.sessionManager.get(session_id);
        if (!session) {
          throw new AppError(404, 'SESSION_NOT_FOUND', `Session ${session_id} not found`);
        }
      } else {
        const auth = getAuthContext(res);
        session = await options.sessionManager.create(role, auth, undefined, undefined, deploy_id);
      }

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
            tenantId: auth.tenantId,
            orgId: auth.orgId,
          };
        }
      }

      const result = await runMessage(session, message, controller.signal, audit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
