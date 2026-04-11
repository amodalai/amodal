/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Studio HTTP API routes.
 *
 * Exposes six endpoints mounted under `/api/studio`:
 *
 *   GET    /api/studio/drafts       - list the caller's drafts
 *   PUT    /api/studio/drafts/*     - save a draft (path suffix = repo-relative file path)
 *   DELETE /api/studio/drafts/*     - revert a single draft
 *   POST   /api/studio/discard      - discard all drafts for the caller
 *   POST   /api/studio/publish      - publish staged drafts as one commit
 *   POST   /api/studio/preview      - build an ephemeral preview snapshot
 *
 * All routes are role-gated via the injected `StudioAuth`. The handlers do
 * not write to disk or query the database directly — they translate HTTP to
 * calls on the injected `StudioBackend` and back.
 *
 * # Error mapping
 *
 * This file is a module boundary per the repo engineering standards, so every
 * handler catches thrown errors and translates them into structured HTTP
 * responses:
 *
 *   StudioFeatureUnavailableError -> 501 {error: 'feature_unavailable', feature, reason}
 *   StudioPublishError            -> 500 {error: 'publish_failed', message}
 *   StudioStorageError            -> 500 {error: 'storage_failed', operation}
 *   anything else                 -> 500 {error: 'internal_error'}  (raw message redacted)
 *
 * `StudioPublishError` is surfaced as 500 (not 409) because `PGLiteStudioBackend`
 * doesn't currently distinguish "concurrent publish" from other failures.
 * Upgrading to 409 for that case can happen in a later PR once the backend
 * reports a distinct reason.
 *
 * # Body size limits
 *
 * JSON and text parsers are both capped at 2 MiB. Skill/knowledge files are
 * typically well under that; the limit exists to prevent DoS from a malicious
 * client pushing a multi-gigabyte payload at the editor. Revisit if a legit
 * use case exceeds it.
 *
 * # PUT body format
 *
 * `PUT /api/studio/drafts/*` accepts either:
 *   - `Content-Type: application/json` with body `{content: string}`, OR
 *   - `Content-Type: text/plain` with the raw file contents as the body.
 *
 * Accepting both keeps the admin agent (which already speaks JSON to every
 * other runtime route) and a raw-text editor UI (which would rather not
 * escape file contents into a JSON string) happy with one endpoint. The
 * JSON form is the canonical shape and matches the files router in runtime.
 */

import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router as ExpressRouter,
} from 'express';
import express from 'express';

import {log as defaultLogger} from '@amodalai/core';
import type {Logger} from '@amodalai/core';

import type {StudioBackend} from './backend.js';
import type {StudioAuth, StudioUser} from './auth.js';
import {
  StudioError,
  StudioFeatureUnavailableError,
  StudioPublishError,
  StudioStorageError,
} from './errors.js';

/** Body size cap for every Studio request. 2 MiB — see file comment. */
const BODY_LIMIT = '2mb';

/**
 * Options for `createStudioRouter`. Both `backend` and `auth` are required
 * and have no default — callers must wire in concrete implementations.
 */
export interface CreateStudioRouterOptions {
  /** Backend providing the draft workspace contract (pglite, Drizzle, etc.). */
  backend: StudioBackend;
  /** Auth provider that decides which requests are allowed through. */
  auth: StudioAuth;
  /**
   * Optional structured logger. Defaults to core's global `log` singleton.
   * All events are emitted on a child logger with `module: 'studio.routes'`
   * so they can be filtered from general runtime logs.
   */
  logger?: Logger;
}

/**
 * Build an Express router hosting the Studio HTTP API. The router is
 * self-contained (mounts its own body parsers) and can be attached at the
 * app level without additional middleware.
 *
 * Example:
 *   const router = createStudioRouter({backend, auth});
 *   app.use(router);
 */
export function createStudioRouter(
  options: CreateStudioRouterOptions,
): ExpressRouter {
  const {backend, auth} = options;
  const logger = (options.logger ?? defaultLogger).child({
    module: 'studio.routes',
  });

  const router = express.Router();

  /**
   * Wrap an async handler so rejected promises propagate to `next()` and the
   * lint rule `@typescript-eslint/no-misused-promises` is satisfied (Express
   * route signatures are `void`-returning).
   */
  function asyncHandler(
    fn: (req: Request, res: Response) => Promise<void>,
  ): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch((err: unknown) => {
        next(err);
      });
    };
  }

  // Body parsers scoped to the router so mounting the router on an app does
  // not implicitly change global body-parser behavior. Both parsers are
  // capped at BODY_LIMIT; oversize payloads get a 413 from express itself.
  router.use(express.json({limit: BODY_LIMIT}));
  router.use(express.text({limit: BODY_LIMIT, type: 'text/plain'}));

  /**
   * Run `auth.authorize` and either return the authenticated user or send
   * the appropriate 401/403/500 response and return null. All denial paths
   * are logged with structured context so operators can correlate failed
   * requests with audit events.
   */
  async function authorizeOrDeny(
    route: string,
    req: Request,
    res: Response,
  ): Promise<StudioUser | null> {
    try {
      const result = await auth.authorize(req);
      if (!result.ok) {
        if (result.reason === 'unauthenticated') {
          logger.warn('studio_route_unauthenticated', {
            route,
            method: req.method,
          });
          res.status(401).json({
            error: 'unauthenticated',
            message: 'Authentication required',
          });
          return null;
        }
        logger.warn('studio_route_forbidden', {
          route,
          method: req.method,
        });
        res.status(403).json({
          error: 'forbidden',
          message: 'Studio access requires admin or ops role',
        });
        return null;
      }
      return result.user;
    } catch (err) {
      // Auth provider infrastructure failure — treat as 500 rather than
      // silently denying, so misconfiguration surfaces instead of looking
      // like "no one is authorized".
      logger.error('studio_auth_failed', {
        route,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        error: 'auth_failed',
        message: 'Failed to resolve user',
      });
      return null;
    }
  }

  /**
   * Map a thrown error from a backend call to a structured HTTP response.
   * Called from the `catch` at every route handler's boundary.
   */
  function sendErrorResponse(
    route: string,
    req: Request,
    res: Response,
    user: StudioUser | null,
    err: unknown,
    startMs: number,
  ): void {
    const durationMs = Date.now() - startMs;
    const userIdRedacted = user ? redactUser(user.userId) : undefined;

    if (err instanceof StudioFeatureUnavailableError) {
      logger.warn('studio_route_feature_unavailable', {
        route,
        method: req.method,
        userId: userIdRedacted,
        feature: err.feature,
        status: 501,
        durationMs,
      });
      res.status(501).json({
        error: 'feature_unavailable',
        feature: err.feature,
        message: err.message,
      });
      return;
    }

    if (err instanceof StudioPublishError) {
      logger.error('studio_route_publish_failed', {
        route,
        method: req.method,
        userId: userIdRedacted,
        filePath: err.filePath,
        status: 500,
        durationMs,
        error: err.message,
      });
      res.status(500).json({
        error: 'publish_failed',
        message: err.message,
      });
      return;
    }

    if (err instanceof StudioStorageError) {
      logger.error('studio_route_storage_failed', {
        route,
        method: req.method,
        userId: userIdRedacted,
        operation: err.operation,
        status: 500,
        durationMs,
        error: err.message,
      });
      res.status(500).json({
        error: 'storage_failed',
        operation: err.operation,
      });
      return;
    }

    if (err instanceof StudioError) {
      // Catch-all for future StudioError subclasses we haven't enumerated.
      logger.error('studio_route_studio_error', {
        route,
        method: req.method,
        userId: userIdRedacted,
        errorName: err.name,
        status: 500,
        durationMs,
        error: err.message,
      });
      res.status(500).json({
        error: 'studio_error',
        message: err.message,
      });
      return;
    }

    // Unknown error — log the full details server-side but do NOT leak the
    // message to the client. Unexpected errors are genuinely surprising and
    // might contain sensitive state (stack traces, library internals, etc.).
    logger.error('studio_route_unexpected_error', {
      route,
      method: req.method,
      userId: userIdRedacted,
      status: 500,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }

  // ---------------------------------------------------------------------------
  // GET /api/studio/drafts
  // ---------------------------------------------------------------------------
  router.get('/api/studio/drafts', asyncHandler(async (req, res) => {
    const route = 'studio_route_list_drafts';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;
    try {
      const drafts = await backend.listDrafts(user.userId);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        count: drafts.length,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json({drafts});
    } catch (err) {
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  // ---------------------------------------------------------------------------
  // PUT /api/studio/drafts/* (save)
  // ---------------------------------------------------------------------------
  router.put('/api/studio/drafts/*', asyncHandler(async (req, res) => {
    const route = 'studio_route_set_draft';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;

    const filePath = extractDraftPath(req);
    const pathError = validateDraftPath(filePath);
    if (pathError) {
      logger.warn('studio_route_bad_path', {
        route,
        method: req.method,
        userId: redactUser(user.userId),
        status: 400,
        durationMs: Date.now() - startMs,
        reason: pathError,
      });
      res.status(400).json({error: 'bad_request', message: pathError});
      return;
    }

    // Accept either text/plain body or {content: string} JSON body.
    const content = extractContent(req);
    if (content === null) {
      logger.warn('studio_route_bad_body', {
        route,
        method: req.method,
        userId: redactUser(user.userId),
        filePath,
        status: 400,
        durationMs: Date.now() - startMs,
      });
      res.status(400).json({
        error: 'bad_request',
        message:
          'Request body must be a text/plain string or JSON {content: string}',
      });
      return;
    }

    try {
      await backend.setDraft(user.userId, filePath, content);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        filePath,
        size: content.length,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json({status: 'ok', filePath});
    } catch (err) {
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  // ---------------------------------------------------------------------------
  // DELETE /api/studio/drafts/* (revert single)
  // ---------------------------------------------------------------------------
  router.delete('/api/studio/drafts/*', asyncHandler(async (req, res) => {
    const route = 'studio_route_delete_draft';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;

    const filePath = extractDraftPath(req);
    const pathError = validateDraftPath(filePath);
    if (pathError) {
      logger.warn('studio_route_bad_path', {
        route,
        method: req.method,
        userId: redactUser(user.userId),
        status: 400,
        durationMs: Date.now() - startMs,
        reason: pathError,
      });
      res.status(400).json({error: 'bad_request', message: pathError});
      return;
    }

    try {
      await backend.deleteDraft(user.userId, filePath);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        filePath,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json({status: 'ok', filePath});
    } catch (err) {
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  // ---------------------------------------------------------------------------
  // POST /api/studio/discard (discard all)
  // ---------------------------------------------------------------------------
  router.post('/api/studio/discard', asyncHandler(async (req, res) => {
    const route = 'studio_route_discard_all';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;

    try {
      // Need the count before discarding for the response + log — listDrafts
      // then discardAll is two calls but contract is "any order of draft ops
      // is valid" so there's no concurrency concern worth mitigating here.
      const drafts = await backend.listDrafts(user.userId);
      await backend.discardAll(user.userId);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        count: drafts.length,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json({status: 'ok', count: drafts.length});
    } catch (err) {
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  // ---------------------------------------------------------------------------
  // POST /api/studio/publish
  // ---------------------------------------------------------------------------
  router.post('/api/studio/publish', asyncHandler(async (req, res) => {
    const route = 'studio_route_publish';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;

    // Body validation: require {commitMessage: string}. We intentionally do
    // NOT log the commit message — it can be operator-supplied free text that
    // should not land in structured logs.
    const commitMessage = readStringField(req.body, 'commitMessage');
    if (commitMessage === null || commitMessage.length === 0) {
      logger.warn('studio_route_bad_body', {
        route,
        method: req.method,
        userId: redactUser(user.userId),
        status: 400,
        durationMs: Date.now() - startMs,
        reason: 'commitMessage missing or empty',
      });
      res.status(400).json({
        error: 'bad_request',
        message: 'commitMessage field is required and must be a non-empty string',
      });
      return;
    }

    try {
      const result = await backend.publish(user.userId, commitMessage);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        commitSha: result.commitSha,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json(result);
    } catch (err) {
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  // ---------------------------------------------------------------------------
  // POST /api/studio/preview
  // ---------------------------------------------------------------------------
  router.post('/api/studio/preview', asyncHandler(async (req, res) => {
    const route = 'studio_route_preview';
    const startMs = Date.now();
    const user = await authorizeOrDeny(route, req, res);
    if (!user) return;

    try {
      const result = await backend.buildPreview(user.userId);
      logger.info(route, {
        method: req.method,
        userId: redactUser(user.userId),
        snapshotId: result.snapshotId,
        status: 200,
        durationMs: Date.now() - startMs,
      });
      res.status(200).json(result);
    } catch (err) {
      // StudioFeatureUnavailableError becomes 501 here via sendErrorResponse,
      // which is what we want: PR 2.2's pglite backend throws exactly that
      // from buildPreview as the "not wired up yet" signal.
      sendErrorResponse(route, req, res, user, err, startMs);
    }
  }));

  return router;
}

/**
 * Extract the repo-relative draft path from `req` for the PUT/DELETE wildcard
 * routes. Express's wildcard puts the suffix in `req.params[0]`. We URL-decode
 * it so that callers can safely encode `/` or other special chars in the URL.
 *
 * Returns an empty string if the wildcard captured nothing — the caller
 * should reject that via `validateDraftPath`.
 */
function extractDraftPath(req: Request): string {
  const raw = req.params[0];
  if (typeof raw !== 'string' || raw.length === 0) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed URI escape — return the raw string and let validateDraftPath
    // reject it. We cannot safely decode it, so it's "bad path" territory.
    return raw;
  }
}

/**
 * Validate that a draft path is something we are willing to forward to the
 * backend. Returns a human-readable error message if the path is rejected,
 * or `null` if it is acceptable.
 *
 * The backend has its own path-escape guard in `resolveDraftPath`, but doing
 * the check here too gives callers clearer errors AND reduces the chance
 * that a bug in the backend guard turns into a file-escape vulnerability.
 *
 * Rejection rules (mirrors backend resolveDraftPath plus a couple extras):
 *   - empty
 *   - contains null byte (blocks C-string truncation tricks)
 *   - starts with `/` (absolute)
 *   - starts with `\` or contains a Windows-style drive (absolute on Win32)
 *   - any segment is exactly `..` (parent-directory traversal)
 *   - starts with `.` segments that escape (handled by `..` rule above)
 */
function validateDraftPath(filePath: string): string | null {
  if (filePath.length === 0) {
    return 'file path required in URL';
  }
  if (filePath.includes('\0')) {
    return 'file path contains null byte';
  }
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    return 'file path must be repo-relative (no leading slash)';
  }
  // Windows drive letter like "C:" at the start.
  if (/^[a-zA-Z]:/.test(filePath)) {
    return 'file path must be repo-relative (no drive letter)';
  }
  // Split on both slash types to catch `foo/../bar` and `foo\..\bar`.
  const segments = filePath.split(/[/\\]/);
  for (const segment of segments) {
    if (segment === '..') {
      return 'file path must not contain parent-directory segments';
    }
  }
  return null;
}

/**
 * Pull the string content out of a PUT request body. Accepts either:
 *   - text/plain body (already a string)
 *   - JSON body with `{content: string}`
 *
 * Returns `null` if neither shape is present — the caller turns that into
 * a 400.
 */
function extractContent(req: Request): string | null {
  const body: unknown = req.body;
  if (typeof body === 'string') return body;
  return readStringField(body, 'content');
}

/**
 * Type-guarded "get a string property from an unknown value". Returns the
 * string value if `body` is a plain object that has `field` set to a string,
 * otherwise null. Avoids `as` casts at the call sites.
 */
function readStringField(body: unknown, field: string): string | null {
  if (!isStringKeyedRecord(body)) return null;
  const value = body[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Type guard: narrows `unknown` to `Record<string, unknown>` without using an
 * `as` cast. Plain objects and arrays both pass; neither of those is a
 * problem for `readStringField` because missing keys become `undefined`.
 */
function isStringKeyedRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Redact a userId before it goes into structured logs. Keeps the first two
 * chars for correlation and strips the rest — same pattern as pglite.ts.
 */
function redactUser(userId: string): string {
  if (userId.length <= 2) return '***';
  return `${userId.slice(0, 2)}***`;
}
