/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Streaming chat route.
 *
 * Accepts POST to /chat and /chat/stream, resolves a session via the
 * standalone session manager, runs the message through the agent loop,
 * and streams SSE events to the client.
 */

import {Router} from 'express';
import {ChatRequestSchema, SSEEventType} from '../types.js';
import type {ChatRequest} from '../types.js';
import {validate} from '../middleware/request-validation.js';
import {getAuthContext} from '../middleware/auth.js';
import type {AuthContext} from '../middleware/auth.js';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {StreamHooks} from '../session/stream-hooks.js';
import {resolveSession} from './session-resolver.js';
import type {BundleResolver, SharedResources, ResolveSessionOptions} from './session-resolver.js';
import {adaptOnUsage, asyncHandler, fireDrainHooks, UNKNOWN_TOOL_NAME} from './route-helpers.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export interface ChatStreamRouterOptions {
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
  /** Factory that builds per-request stream hooks from the auth context */
  createStreamHooks?: (auth?: AuthContext) => StreamHooks;
  /** Server-side summarizer hook passed into every runMessage call. */
  summarizeToolResult?: (opts: {
    toolName: string;
    content: string;
    signal: AbortSignal;
  }) => Promise<string>;
  /** Hook to enhance session components before session creation. */
  onSessionBuild?: ResolveSessionOptions['onSessionBuild'];
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createChatStreamRouter(
  options: ChatStreamRouterOptions,
): Router {
  const router = Router();

  // Mount on both /chat and /chat/stream so the SPA always gets SSE
  router.post(
    ['/chat', '/chat/stream'],
    validate(ChatRequestSchema),
    asyncHandler(async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by Zod middleware
        const body = req.body as ChatRequest;
        const auth = getAuthContext(res);

        const {session, toolContextFactory} = await resolveSession(body.session_id, {
          sessionManager: options.sessionManager,
          bundleResolver: options.bundleResolver,
          shared: options.shared,
          sessionType: body.session_type,
          deployId: body.deploy_id,
          auth,
          maxSessionTokens: body.max_session_tokens,
          onSessionBuild: options.onSessionBuild,
        });

        // Set up SSE headers (use setHeader to preserve CORS headers from middleware)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const controller = new AbortController();
        res.on('close', () => controller.abort());

        const hooks = options.createStreamHooks?.(auth);

        const stream = options.sessionManager.runMessage(
          session.id,
          body.message,
          {
            images: body.images,
            signal: controller.signal,
            buildToolContext: toolContextFactory,
            onUsage: adaptOnUsage(hooks, session),
            summarizeToolResult: options.summarizeToolResult,
          },
        );

        // Track tool calls for audit log
        const toolNames = new Map<string, string>();
        const toolCalls: Array<{tool_name: string; tool_id: string; status: string}> = [];

        for await (const event of stream) {
          if (controller.signal.aborted) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);

          if (event.type === SSEEventType.ToolCallStart) {
            toolNames.set(event.tool_id, event.tool_name);
          } else if (event.type === SSEEventType.ToolCallResult) {
            toolCalls.push({
              tool_name: toolNames.get(event.tool_id) ?? UNKNOWN_TOOL_NAME,
              tool_id: event.tool_id,
              status: event.status,
            });
          }
        }

        await fireDrainHooks(options.sessionManager, hooks, {session, toolCalls});

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
    }),
  );

  return router;
}
