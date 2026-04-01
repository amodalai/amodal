/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {AgentChatRequestSchema} from '../agent-types.js';
import type {SessionManager} from '../../session/session-manager.js';
import {streamMessage} from '../../session/session-runner.js';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';

export interface AdminChatRouterOptions {
  sessionManager: SessionManager;
}

function writeSSE(res: Response, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function ts(): string {
  return new Date().toISOString();
}

/**
 * Router for the admin/config chat. Creates admin sessions with admin agent
 * skills/knowledge, isolated from the primary agent.
 */
export function createAdminChatRouter(options: AdminChatRouterOptions): Router {
  const router = Router();

  router.post('/config/chat', async (req: Request, res: Response) => {
    const parsed = AgentChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid request', details: parsed.error.issues});
      return;
    }

    const {message, session_id: sessionId} = parsed.data;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      // Get or create admin session
      let session = sessionId ? options.sessionManager.get(sessionId) : undefined;
      if (!session) {
        try {
          session = await options.sessionManager.createAdminSession();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          writeSSE(res, {type: SSEEventType.Error, message: `Admin agent unavailable: ${errMsg}`, timestamp: ts()});
          writeSSE(res, {type: SSEEventType.Done, timestamp: ts()});
          res.end();
          return;
        }
      }

      writeSSE(res, {type: SSEEventType.Init, session_id: session.id, timestamp: ts()});

      const controller = new AbortController();
      res.on('close', () => controller.abort());

      for await (const event of streamMessage(session, message, controller.signal)) {
        if (controller.signal.aborted) break;
        writeSSE(res, event);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      writeSSE(res, {type: SSEEventType.Error, message: errMsg, timestamp: ts()});
    }

    writeSSE(res, {type: SSEEventType.Done, timestamp: ts()});
    res.end();
  });

  return router;
}
