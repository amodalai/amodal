/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Non-streaming chat route (Phase 3.5c).
 *
 * Accepts POST to /chat/sync, resolves a session, runs the message through
 * the agent loop, collects all events, and returns a JSON ChatResponse.
 */

import {Router} from 'express';
import {ChatRequestSchema, SSEEventType} from '../types.js';
import type {ChatRequest, ChatResponse, ToolCallSummary} from '../types.js';
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

export interface ChatRouterOptions {
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
  /** Factory that builds per-request stream hooks from the auth context */
  createStreamHooks?: (auth?: AuthContext) => StreamHooks;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.post('/chat/sync', validate(ChatRequestSchema), async (req, res, next) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by Zod middleware
      const body = req.body as ChatRequest;
      const auth = getAuthContext(res);

      // Resolve session (lookup in memory, resume from store, or create new)
      const {session, toolContextFactory} = await resolveSession(body.session_id, {
        sessionManager: options.sessionManager,
        bundleResolver: options.bundleResolver,
        shared: options.shared,
        role: body.role,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- string → SessionType at system boundary
        sessionType: body.session_type as SessionType | undefined,
        deployId: body.deploy_id,
        auth,
      });

      const controller = new AbortController();

      // Abort on client disconnect
      res.on('close', () => controller.abort());

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

      // Run message and collect events
      const stream = options.sessionManager.runMessage(
        session.id,
        body.message,
        {
          signal: controller.signal,
          buildToolContext: toolContextFactory,
          onUsage,
        },
      );

      let responseText = '';
      const toolNames = new Map<string, string>();
      const toolCalls: ToolCallSummary[] = [];

      for await (const event of stream) {
        if (controller.signal.aborted) break;

        if (event.type === SSEEventType.TextDelta) {
          responseText += event.content;
        } else if (event.type === SSEEventType.ToolCallStart) {
          toolNames.set(event.tool_id, event.tool_name);
        } else if (event.type === SSEEventType.ToolCallResult) {
          toolCalls.push({
            tool_name: toolNames.get(event.tool_id) ?? 'unknown',
            tool_id: event.tool_id,
            status: event.status,
            error: event.error,
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

      const result: ChatResponse = {
        session_id: session.id,
        response: responseText,
        tool_calls: toolCalls,
      };

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
