/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {AgentChatRequestSchema} from '../agent-types.js';
import type {AgentSession} from '../agent-types.js';
import type {AgentSessionManager} from '../session-manager.js';
import {runAgentTurn} from '../agent-runner.js';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';

/**
 * Optional hook for customizing session creation.
 * When provided, called instead of sessionManager.create().
 * Receives the Express request and response (for auth context access).
 */
export type SessionCreator = (req: Request, res: Response, tenantId: string, tenantToken?: string) => Promise<AgentSession>;

/**
 * Optional hook for hydrating a session from external storage.
 * Called when session_id is provided but not found in memory.
 */
export type SessionHydrator = (req: Request, res: Response, sessionId: string, tenantId: string) => Promise<AgentSession | null>;

/**
 * Optional hook called after each agent turn completes.
 * Used by hosted runtime to persist conversation history.
 */
export type TurnCompleteHandler = (session: AgentSession, req: Request, res: Response) => void;

export interface ChatRouterOptions {
  sessionManager: AgentSessionManager;
  /** Optional session creator hook — used by hosted runtime to inject tenant config from platform API */
  sessionCreator?: SessionCreator;
  /** Optional session hydrator — called when session_id not found in memory (e.g., load from platform API) */
  sessionHydrator?: SessionHydrator;
  /** Optional callback after each agent turn — used for persisting conversation history */
  onTurnComplete?: TurnCompleteHandler;
}

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    const parsed = AgentChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.message,
        },
      });
      return;
    }

    const {message, session_id, tenant_id, tenant_token} = parsed.data;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Get or create session
    let session = session_id ? options.sessionManager.get(session_id) : undefined;

    // Try hydration if session not in memory
    if (!session && session_id && options.sessionHydrator) {
      try {
        session = await options.sessionHydrator(req, res, session_id, tenant_id) ?? undefined;
      } catch {
        // Hydration failed — fall through to create new session
      }
    }

    if (!session) {
      try {
        session = options.sessionCreator
          ? await options.sessionCreator(req, res, tenant_id, tenant_token)
          : await options.sessionManager.create(tenant_id, tenant_token);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        writeSSE(res, {type: SSEEventType.Error, message: errMsg, timestamp: ts()});
        writeSSE(res, {type: SSEEventType.Done, timestamp: ts()});
        res.end();
        return;
      }
    }

    // Send init event
    writeSSE(res, {type: SSEEventType.Init, session_id: session.id, timestamp: ts()});

    // Abort on client disconnect (use res, not req — req closes when body is consumed)
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    try {
      for await (const event of runAgentTurn(session, message, controller.signal)) {
        if (controller.signal.aborted) break;
        writeSSE(res, event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const errMsg = err instanceof Error ? err.message : String(err);
        writeSSE(res, {type: SSEEventType.Error, message: errMsg, timestamp: ts()});
        writeSSE(res, {type: SSEEventType.Done, timestamp: ts()});
      }
    }

    // Notify after turn completes (e.g., persist history)
    if (options.onTurnComplete) {
      options.onTurnComplete(session, req, res);
    }

    res.end();
  });

  return router;
}

function writeSSE(res: Response, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function ts(): string {
  return new Date().toISOString();
}
