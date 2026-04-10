/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { createLogger } from '../utils/log';

const log = createLogger('useMe');

/**
 * Three roles understood by the runtime, ordered by privilege:
 * `user` < `admin` < `ops`.
 *
 * Mirrored from `@amodalai/runtime`'s `RuntimeRole` type. Kept inline here so
 * the runtime-app doesn't need a runtime dependency in the browser bundle.
 */
export type RuntimeRole = 'user' | 'admin' | 'ops';

export interface RuntimeUser {
  id: string;
  role: RuntimeRole;
}

export interface MeState {
  /** Whether the initial /api/me fetch has completed (success or failure). */
  ready: boolean;
  /** The current user, or null if unauthenticated. */
  user: RuntimeUser | null;
}

/** Privilege ordering for `hasRole` comparisons. */
const ROLE_LEVEL: Record<RuntimeRole, number> = {
  user: 0,
  admin: 1,
  ops: 2,
};

/**
 * Check whether the user satisfies a minimum role requirement.
 * Useful for inline checks in conditional rendering:
 *
 * ```tsx
 * {hasRole(me.user, 'ops') && <OpsOnlyPanel />}
 * ```
 */
export function hasRole(user: RuntimeUser | null, minRole: RuntimeRole): boolean {
  if (!user) return false;
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[minRole];
}

/** Timeout for the /api/me fetch. */
const ME_FETCH_TIMEOUT_MS = 10_000;

/** Runtime endpoint that returns the current user. */
const ME_ENDPOINT = '/api/me';

/**
 * Read a string field from a record-shaped value. Returns undefined if missing
 * or not a string.
 */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === 'string' ? val : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate a /api/me response body. Returns null if the shape is wrong or
 * the role isn't one of the three known values.
 */
function parseRuntimeUser(value: unknown): RuntimeUser | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id');
  const role = readString(value, 'role');
  if (!id || !role) return null;
  if (role !== 'user' && role !== 'admin' && role !== 'ops') return null;
  return { id, role };
}

/**
 * Fetch the current user's role from the runtime's /api/me endpoint.
 *
 * Behavior:
 * - On 200, returns `{ ready: true, user: {id, role} }`
 * - On 401, returns `{ ready: true, user: null }`
 * - On network error / timeout / other failure, logs and returns
 *   `{ ready: true, user: null }` so the UI degrades to user-level access
 *   instead of showing admin/ops UI to a broken session.
 *
 * The hook is safe to call from anywhere — it does not depend on context.
 * In `amodal dev` the endpoint always returns `{role: 'ops'}` so this
 * effectively unlocks all UI by default.
 */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ ready: false, user: null });

  useEffect(() => {
    let cancelled = false;

    /**
     * Resolve the user state by fetching /api/me. Returns the next state or
     * null if the call should be ignored (component unmounted mid-fetch).
     */
    async function resolveUser(): Promise<MeState | null> {
      try {
        const res = await fetch(ME_ENDPOINT, {
          signal: AbortSignal.timeout(ME_FETCH_TIMEOUT_MS),
          credentials: 'include',
        });

        if (res.status === 401) {
          // Explicitly unauthenticated — surface as null user.
          return { ready: true, user: null };
        }

        if (!res.ok) {
          log.warn('me_fetch_non_ok', { status: res.status });
          return { ready: true, user: null };
        }

        const body: unknown = await res.json();
        const user = parseRuntimeUser(body);
        if (!user) {
          log.warn('me_response_invalid_shape', { body });
          return { ready: true, user: null };
        }

        return { ready: true, user };
      } catch (err) {
        // Network failure / timeout / abort — fail closed (no role).
        log.warn('me_fetch_failed', { err });
        return { ready: true, user: null };
      }
    }

    void resolveUser().then((next) => {
      if (cancelled || !next) return;
      setState(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
