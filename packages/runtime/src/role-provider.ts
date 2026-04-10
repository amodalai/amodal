/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * RoleProvider — minimal user role abstraction for role-gated routes.
 *
 * The OSS runtime defines this interface; hosting layers (cloud, self-hosted,
 * `amodal dev`) provide their own implementations:
 *  - `amodal dev`: returns `ops` for everyone (the developer is the only user)
 *  - cloud: parses platform JWT claims → ops/admin/user
 *  - self-hosted: customer plugs in their own auth (OIDC, custom JWT, etc.)
 *
 * The runtime gates admin/ops API routes through `requireRole` middleware
 * which calls into the configured RoleProvider on each request.
 */

import type {Request, RequestHandler} from 'express';
import {asyncHandler} from './routes/route-helpers.js';
import {createLogger} from './logger.js';

const log = createLogger({component: 'role-provider'});

/**
 * The three roles the runtime understands. Roles are ordered by privilege:
 * `user` < `admin` < `ops`.
 *
 *  - `user`  — end-user. Can chat with the agent and see their own sessions.
 *  - `admin` — agent admin (Sally). Can edit content (skills, knowledge, prompts)
 *              and view operational state (sessions, automations, stores).
 *              Cannot edit infrastructure (connections, model, tools).
 *  - `ops`   — developer / platform admin. Can edit everything including
 *              connections, model config, and custom tools. Can run evals and
 *              inspect runtime internals.
 */
export type RuntimeRole = 'user' | 'admin' | 'ops';

/**
 * Numeric privilege level for each role. Used by `requireRole` to compare
 * the resolved role against the route's minimum requirement.
 */
const ROLE_LEVEL: Record<RuntimeRole, number> = {
  user: 0,
  admin: 1,
  ops: 2,
};

export interface RuntimeUser {
  /** Stable identifier for the user (email, sub claim, or 'local-dev'). */
  id: string;
  /** The user's role. Determines which routes they can access. */
  role: RuntimeRole;
}

export interface RoleProvider {
  /**
   * Resolve the current user from the HTTP request, or `null` if the request
   * is unauthenticated.
   *
   * Implementations should be stateless and cheap to call — `requireRole`
   * invokes them on every protected request.
   */
  resolveUser(req: Request): Promise<RuntimeUser | null>;
}

/**
 * Default RoleProvider used when none is configured.
 *
 * Returns `ops` for every request — appropriate for `amodal dev` (where the
 * developer is the only user) and for backwards compatibility with existing
 * deployments that don't yet provide a RoleProvider.
 *
 * Hosting layers MUST replace this with their own implementation in production.
 */
export const defaultRoleProvider: RoleProvider = {
  async resolveUser(): Promise<RuntimeUser> {
    return {id: 'local-dev', role: 'ops'};
  },
};

/**
 * Express middleware factory that gates a route on a minimum role.
 *
 * Usage:
 * ```
 * app.put('/api/files/*', requireRole(roleProvider, 'admin'), handler);
 * app.put('/api/connections/*', requireRole(roleProvider, 'ops'), handler);
 * ```
 *
 * Behavior:
 *  - 401 if `resolveUser` returns null (unauthenticated)
 *  - 403 if the user's role is below the minimum
 *  - Otherwise sets `res.locals.user` and calls `next()`
 *
 * The resolved user is attached to `res.locals.user` so handlers can read it
 * without re-resolving.
 */
export function requireRole(
  roleProvider: RoleProvider,
  minRole: RuntimeRole,
): RequestHandler {
  const minLevel = ROLE_LEVEL[minRole];
  return asyncHandler(async (req, res, next) => {
    let user: RuntimeUser | null;
    try {
      user = await roleProvider.resolveUser(req);
    } catch (err) {
      // RoleProvider failures are infrastructure errors. Log with context and
      // forward as a typed error to the central error handler, which will
      // sanitize the response (we deliberately don't expose the underlying
      // error message to the client here).
      log.error('role_provider_failed', {
        path: req.path,
        method: req.method,
        required_role: minRole,
        error: err instanceof Error ? err.message : String(err),
      });
      next(new RoleProviderError(
        'role_provider_failed',
        'Failed to resolve user role',
        err,
      ));
      return;
    }

    if (!user) {
      log.warn('role_check_unauthenticated', {
        path: req.path,
        method: req.method,
        required_role: minRole,
      });
      res.status(401).json({
        error: {code: 'unauthenticated', message: 'Authentication required'},
      });
      return;
    }

    if (ROLE_LEVEL[user.role] < minLevel) {
      log.warn('role_check_forbidden', {
        path: req.path,
        method: req.method,
        user_id: user.id,
        current_role: user.role,
        required_role: minRole,
      });
      res.status(403).json({
        error: {
          code: 'forbidden',
          message: `Requires ${minRole} role`,
          required_role: minRole,
          current_role: user.role,
        },
      });
      return;
    }

    res.locals['user'] = user;
    next();
  });
}

/**
 * Typed error thrown when the RoleProvider itself fails (not when a user
 * is unauthenticated or forbidden — those are handled directly with HTTP
 * status codes).
 */
export class RoleProviderError extends Error {
  readonly code: string;
  override readonly cause: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'RoleProviderError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Compare two roles. Returns true if `a` is at least as privileged as `b`.
 * Useful for inline checks inside route handlers.
 */
export function hasRole(user: RuntimeUser | null, minRole: RuntimeRole): boolean {
  if (!user) return false;
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[minRole];
}
