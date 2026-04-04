/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Streaming chat route (Phase 3.5c).
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
import type {StreamHooks} from '../session/session-runner.js';
import type {TurnUsage} from '../session/types.js';
import {resolveSession} from './session-resolver.js';
import type {BundleResolver, SharedResources} from './session-resolver.js';
import type {SessionType} from '../session/session-builder.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export interface ChatStreamRouterOptions {
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
  /** Factory that builds per-request stream hooks from the auth context */
  createStreamHooks?: (auth?: AuthContext) => StreamHooks;
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
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by Zod middleware
        const body = req.body as ChatRequest;
        const auth = getAuthContext(res);

        // Resolve session (lookup in memory, resume from store, or create new)
        const {session, components} = await resolveSession(body.session_id, {
          sessionManager: options.sessionManager,
          bundleResolver: options.bundleResolver,
          shared: options.shared,
          role: body.role,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- string → SessionType at system boundary
          sessionType: body.session_type as SessionType | undefined,
          deployId: body.deploy_id,
          auth,
        });

        // Set up SSE headers (use setHeader to preserve CORS headers from middleware)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const controller = new AbortController();

        // Abort on client disconnect
        res.on('close', () => controller.abort());

        // Build per-request hooks with auth context
        const hooks = options.createStreamHooks?.(auth);

        // Adapt onUsageReport hook to TurnUsage callback
        const onUsage = hooks?.onUsageReport
          ? (usage: TurnUsage) => {
              hooks.onUsageReport?.({
                model: session.model,
                taskAgentRuns: 0,
                tokens: {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cachedTokens: usage.cachedInputTokens,
                },
              });
            }
          : undefined;

        // Run message through the agent loop
        const stream = options.sessionManager.runMessage(
          session.id,
          body.message,
          {
            signal: controller.signal,
            buildToolContext: components.toolContextFactory,
            onUsage,
          },
        );

        // Track tool calls for audit log
        const toolNames = new Map<string, string>();
        const toolCalls: Array<{tool_name: string; tool_id: string; status: string}> = [];

        for await (const event of stream) {
          if (controller.signal.aborted) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);

          // Collect tool call info for audit
          if (event.type === SSEEventType.ToolCallStart) {
            toolNames.set(event.tool_id, event.tool_name);
          } else if (event.type === SSEEventType.ToolCallResult) {
            toolCalls.push({
              tool_name: toolNames.get(event.tool_id) ?? 'unknown',
              tool_id: event.tool_id,
              status: event.status,
            });
          }
        }

        // Fire post-drain hooks
        if (hooks?.onAuditLog) {
          hooks.onAuditLog({
            event: 'session_completed',
            resource_name: session.id,
            details: {
              session_id: session.id,
              tool_calls: toolCalls,
              model: session.model,
              provider: session.providerName,
            },
          });
        }

        if (hooks?.onSessionPersist) {
          hooks.onSessionPersist(session.id, [], 'completed', {
            model: session.model,
            provider: session.providerName,
          });
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
