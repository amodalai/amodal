/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Non-streaming chat route.
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
import type {StreamHooks} from '../session/stream-hooks.js';
import {resolveSession} from './session-resolver.js';
import type {BundleResolver, SharedResources} from './session-resolver.js';
import {adaptOnUsage, asyncHandler, fireDrainHooks, UNKNOWN_TOOL_NAME} from './route-helpers.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export interface ChatRouterOptions {
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
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  router.post('/chat/sync', validate(ChatRequestSchema), asyncHandler(async (req, res, next) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by Zod middleware
      const body = req.body as ChatRequest;
      const auth = getAuthContext(res);

      const {session, toolContextFactory} = await resolveSession(body.session_id, {
        sessionManager: options.sessionManager,
        bundleResolver: options.bundleResolver,
        shared: options.shared,
        role: body.role,
        sessionType: body.session_type,
        deployId: body.deploy_id,
        auth,
        maxTokens: body.max_tokens,
      });

      const controller = new AbortController();
      res.on('close', () => controller.abort());

      const hooks = options.createStreamHooks?.(auth);

      const stream = options.sessionManager.runMessage(
        session.id,
        body.message,
        {
          signal: controller.signal,
          buildToolContext: toolContextFactory,
          onUsage: adaptOnUsage(hooks, session),
          summarizeToolResult: options.summarizeToolResult,
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
            tool_name: toolNames.get(event.tool_id) ?? UNKNOWN_TOOL_NAME,
            tool_id: event.tool_id,
            status: event.status,
            error: event.error,
          });
        }
      }

      await fireDrainHooks(options.sessionManager, hooks, {session, toolCalls});

      const result: ChatResponse = {
        session_id: session.id,
        response: responseText,
        tool_calls: toolCalls,
      };

      res.json(result);
    } catch (err) {
      next(err);
    }
  }));

  return router;
}
