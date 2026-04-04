/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared helpers for chat route handlers.
 *
 * Deduplicates post-drain hook logic and session persistence across
 * chat-stream, ai-stream, and chat routes.
 */

import type {Request, Response, NextFunction, RequestHandler} from 'express';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {Session, TurnUsage} from '../session/types.js';
import type {StreamHooks} from '../session/stream-hooks.js';

// ---------------------------------------------------------------------------
// Async handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an async Express handler so rejected promises propagate to the error
 * middleware instead of hanging the request.
 *
 * Express doesn't await async handlers — if one throws, the request hangs
 * forever. This wrapper catches the rejection and passes it to `next()`.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | Promise<Response>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback name for tools where the ToolCallStart event was missed. */
export const UNKNOWN_TOOL_NAME = 'unknown';

/** Audit event name emitted after a message completes. */
export const AUDIT_SESSION_COMPLETED = 'session_completed';

// ---------------------------------------------------------------------------
// Post-drain hooks
// ---------------------------------------------------------------------------

interface DrainContext {
  session: Session;
  toolCalls: Array<{tool_name: string; tool_id: string; status: string}>;
}

/**
 * Adapt the old `onUsageReport` hook to the new `TurnUsage` callback
 * expected by `StandaloneSessionManager.runMessage`.
 */
export function adaptOnUsage(
  hooks: StreamHooks | undefined,
  session: Session,
): ((usage: TurnUsage) => void) | undefined {
  if (!hooks?.onUsageReport) return undefined;
  return (usage: TurnUsage) => {
    hooks.onUsageReport?.({
      model: session.model,
      taskAgentRuns: 0,
      tokens: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedInputTokens,
      },
    });
  };
}

/**
 * Fire post-drain hooks and persist the session.
 *
 * Called after the runMessage generator is fully consumed. Handles:
 * - Explicit session persistence (belt-and-suspenders with runMessage's internal persist)
 * - Audit log hook with tool call summary
 * - Session persist hook for hosted-mode analytics
 */
export async function fireDrainHooks(
  sessionManager: StandaloneSessionManager,
  hooks: StreamHooks | undefined,
  ctx: DrainContext,
): Promise<void> {
  const {session, toolCalls} = ctx;

  // Persist session explicitly — runMessage persists internally when a store
  // is configured, but the route also needs to persist when the generator is
  // aborted mid-stream (the generator's post-loop code doesn't run on abort).
  await sessionManager.persist(session);

  if (hooks?.onAuditLog) {
    hooks.onAuditLog({
      event: AUDIT_SESSION_COMPLETED,
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
}
