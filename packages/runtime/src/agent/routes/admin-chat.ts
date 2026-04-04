/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin chat route (Phase 3.5d).
 *
 * Creates admin sessions with admin agent skills/knowledge, isolated from
 * the primary agent. Uses StandaloneSessionManager + buildSessionComponents
 * with sessionType 'admin'.
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {ensureAdminAgent, loadAdminAgent} from '@amodalai/core';
import type {AgentBundle} from '@amodalai/types';
import {AgentChatRequestSchema} from '../agent-types.js';
import type {StandaloneSessionManager} from '../../session/manager.js';
import {buildSessionComponents} from '../../session/session-builder.js';
import type {SharedResources} from '../../routes/session-resolver.js';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import {SessionError} from '../../errors.js';

export interface AdminChatRouterOptions {
  sessionManager: StandaloneSessionManager;
  shared: SharedResources;
  /** The bundle for the current agent repo. */
  getBundle: () => AgentBundle | undefined;
  getPort?: () => number | null;
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

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
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
      const bundle = options.getBundle();
      if (!bundle) {
        throw new SessionError('Admin sessions require a bundle', {
          sessionId: sessionId ?? 'new',
          context: {operation: 'admin_chat'},
        });
      }

      if (bundle.source !== 'local') {
        throw new SessionError('Admin sessions are only available for local repos', {
          sessionId: sessionId ?? 'new',
          context: {operation: 'admin_chat', source: bundle.source},
        });
      }

      // Check for existing in-memory session
      let session = sessionId ? options.sessionManager.get(sessionId) : undefined;
      let toolContextFactory = session?.toolContextFactory;

      if (!session) {
        // Load admin agent content
        const agentDir = await ensureAdminAgent(bundle.origin);
        const adminContent = await loadAdminAgent(agentDir);

        // Build components with admin content swapped in
        const components = buildSessionComponents({
          bundle,
          storeBackend: options.shared.storeBackend,
          mcpManager: options.shared.mcpManager,
          logger: options.shared.logger,
          toolExecutor: options.shared.toolExecutor,
          fieldScrubber: options.shared.fieldScrubber,
          sessionType: 'admin',
          adminContent,
          repoRoot: bundle.origin,
          getPort: options.getPort,
          appId: 'admin',
        });

        session = options.sessionManager.create({
          tenantId: 'local',
          userId: 'admin',
          provider: components.provider,
          toolRegistry: components.toolRegistry,
          permissionChecker: components.permissionChecker,
          systemPrompt: components.systemPrompt,
          userRoles: components.userRoles,
          toolContextFactory: components.toolContextFactory,
          appId: 'admin',
        });

        toolContextFactory = components.toolContextFactory;
      }

      writeSSE(res, {type: SSEEventType.Init, session_id: session.id, timestamp: ts()});

      const controller = new AbortController();
      res.on('close', () => controller.abort());

      for await (const event of options.sessionManager.runMessage(
        session.id,
        message,
        {
          signal: controller.signal,
          buildToolContext: toolContextFactory,
        },
      )) {
        if (controller.signal.aborted) break;
        writeSSE(res, event);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      writeSSE(res, {type: SSEEventType.Error, message: `Admin agent unavailable: ${errMsg}`, timestamp: ts()});
    }

    writeSSE(res, {type: SSEEventType.Done, timestamp: ts()});
    res.end();
  });

  return router;
}
