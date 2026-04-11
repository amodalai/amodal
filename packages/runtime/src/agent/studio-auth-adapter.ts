/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Adapt the runtime's existing `RoleProvider` to Studio's `StudioAuth` contract.
 *
 * Runtime's `RoleProvider` returns a `RuntimeUser` with a `RuntimeRole`
 * (`user` | `admin` | `ops`); Studio's `StudioAuth` returns a discriminated
 * result keyed on whether the request is allowed. Per the runtime-architecture
 * plan, Studio permits `admin` and `ops` and denies `user`.
 *
 * This adapter lives in `@amodalai/runtime` (the consumer) rather than in
 * `@amodalai/studio` (the producer) because making Studio depend on Runtime
 * would create the package-level import cycle that `StudioAuth`'s interface
 * was introduced to avoid. Keeping the adapter here — where we already depend
 * on Studio — preserves the one-way dependency direction.
 *
 * The adapter is deliberately tiny: it does NOT re-implement authentication,
 * it only translates the shape from one interface to the other.
 */

import type {Request} from 'express';
import type {StudioAuth, StudioAuthResult, StudioRole} from '@amodalai/studio';

import type {RoleProvider, RuntimeRole} from '../role-provider.js';

/**
 * Map a `RuntimeRole` to a `StudioRole`, or `null` if the role is not
 * permitted to access Studio (i.e. `user`). Kept as an exhaustive switch so
 * adding a new `RuntimeRole` variant later produces a compile error here
 * rather than silently falling through.
 */
function runtimeRoleToStudioRole(role: RuntimeRole): StudioRole | null {
  switch (role) {
    case 'admin':
      return 'admin';
    case 'ops':
      return 'ops';
    case 'user':
      return null;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/**
 * Build a `StudioAuth` backed by an existing `RoleProvider`.
 *
 * Denial mapping:
 *  - `resolveUser` returns `null`           → `{ok: false, reason: 'unauthenticated'}`
 *  - `resolveUser` returns role `user`      → `{ok: false, reason: 'forbidden'}`
 *  - `resolveUser` returns role `admin|ops` → `{ok: true, user: {userId, role}}`
 *
 * Infrastructure errors from the underlying `RoleProvider` propagate out to
 * the Studio router, which translates them to a 500 response (per the
 * `StudioAuth` interface contract).
 */
export function createStudioAuthFromRoleProvider(
  roleProvider: RoleProvider,
): StudioAuth {
  return {
    async authorize(req: Request): Promise<StudioAuthResult> {
      const user = await roleProvider.resolveUser(req);
      if (!user) {
        return {ok: false, reason: 'unauthenticated'};
      }
      const studioRole = runtimeRoleToStudioRole(user.role);
      if (studioRole === null) {
        return {ok: false, reason: 'forbidden'};
      }
      return {
        ok: true,
        user: {
          userId: user.id,
          role: studioRole,
        },
      };
    },
  };
}
