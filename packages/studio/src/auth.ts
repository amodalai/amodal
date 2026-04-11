/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Minimal auth contract for the Studio HTTP API.
 *
 * Why this lives in `@amodalai/studio` and NOT `@amodalai/runtime`:
 *
 * `@amodalai/runtime` already defines a `RoleProvider` interface for role-gated
 * routes. In PR 2.8 the runtime will mount Studio into `amodal dev`, which
 * means `runtime` will import from `studio`. If `studio` also imported from
 * `runtime`, we would create a package-level import cycle.
 *
 * To avoid that, Studio defines its own structurally-compatible interface
 * here and PR 2.8 provides a thin adapter (inside `runtime`) that translates
 * runtime's `RuntimeUser`/`Role` shape to studio's `StudioAuth` shape. That
 * adapter is ~10 lines and keeps this package framework- and cycle-free.
 *
 * Contract:
 *
 * - `authorize(req)` returns a `StudioUser` if the request is both authenticated
 *   AND permitted to access Studio routes, otherwise `null`.
 * - The router translates `null` into an HTTP response. Implementations should
 *   NOT write to the response themselves — all transport concerns stay in the
 *   router layer.
 * - Per the runtime-architecture plan, the permitted roles are `admin` and
 *   `ops` — `user` is denied. The distinction between "unauthenticated" (401)
 *   and "authenticated but denied" (403) is signaled by the `reason` field on
 *   the rejected variant of the result.
 * - Implementations should be stateless and cheap to call: the router calls
 *   `authorize` on every incoming request.
 */

import type {Request} from 'express';

/** Roles allowed to access Studio routes. `user` is rejected before ever reaching here. */
export type StudioRole = 'admin' | 'ops';

/** The authenticated user resolved from an incoming request. */
export interface StudioUser {
  /** Stable identifier for the user (email, sub claim, or 'local-dev'). */
  userId: string;
  /** The user's role. Both `admin` and `ops` are permitted to use Studio. */
  role: StudioRole;
}

/**
 * Discriminated result from `StudioAuth.authorize`. The router uses the
 * `reason` field to pick between 401 (unauthenticated) and 403 (forbidden).
 */
export type StudioAuthResult =
  | {ok: true; user: StudioUser}
  | {ok: false; reason: 'unauthenticated' | 'forbidden'};

/**
 * Auth provider contract for the Studio HTTP API. See the file-level comment
 * for why this interface exists in `@amodalai/studio` rather than being
 * imported from `@amodalai/runtime`.
 */
export interface StudioAuth {
  /**
   * Resolve the effective Studio user from an incoming request.
   *
   * Returns `{ok: true, user}` if the caller is authenticated and permitted
   * to access Studio; `{ok: false, reason: 'unauthenticated'}` if there is
   * no identifiable user on the request; or `{ok: false, reason: 'forbidden'}`
   * if the user is identified but not permitted (e.g. role `user`).
   *
   * Implementations must not throw for the normal "no auth / wrong role"
   * cases — those are expected outcomes and should be returned as `ok: false`
   * so the router can produce the correct HTTP status. Only throw for
   * infrastructure errors (e.g. upstream identity provider unreachable); the
   * router translates thrown errors into 500 responses.
   */
  authorize(req: Request): Promise<StudioAuthResult>;
}
