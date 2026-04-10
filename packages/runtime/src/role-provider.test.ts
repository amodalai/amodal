/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import type {Request, Response, NextFunction} from 'express';
import {
  defaultRoleProvider,
  requireRole,
  hasRole,
  RoleProviderError,
  type RoleProvider,
  type RuntimeUser,
} from './role-provider.js';

interface MockRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  locals: Record<string, unknown>;
}

function createMockRes(): MockRes {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals: {},
  };
}

function makeProvider(user: RuntimeUser | null): RoleProvider {
  return {
    async resolveUser() {
      return user;
    },
  };
}

/**
 * Run an Express middleware and wait for it to settle by racing two signals:
 * either `next()` was called, or `res.json()` was called. This avoids the
 * brittle `setTimeout(0)` microtask-flush hack.
 */
async function runMiddleware(
  middleware: ReturnType<typeof requireRole>,
  res: MockRes,
): Promise<{nextCalls: unknown[][]}> {
  const nextCalls: unknown[][] = [];
  const settled = new Promise<void>((resolve) => {
    const onSettle = (): void => { resolve(); };
    res.json.mockImplementation(() => { onSettle(); return res; });
    const next: NextFunction = (...args: unknown[]) => {
      nextCalls.push(args);
      onSettle();
    };
    middleware({} as Request, res as unknown as Response, next);
  });
  await settled;
  return {nextCalls};
}

// ---------------------------------------------------------------------------
// defaultRoleProvider
// ---------------------------------------------------------------------------

describe('defaultRoleProvider', () => {
  it('returns ops for any request', async () => {
    const user = await defaultRoleProvider.resolveUser({} as Request);
    expect(user).toEqual({id: 'local-dev', role: 'ops'});
  });
});

// ---------------------------------------------------------------------------
// hasRole
// ---------------------------------------------------------------------------

describe('hasRole', () => {
  const user: RuntimeUser = {id: 'u1', role: 'user'};
  const admin: RuntimeUser = {id: 'a1', role: 'admin'};
  const ops: RuntimeUser = {id: 'o1', role: 'ops'};

  it('user does not satisfy admin', () => {
    expect(hasRole(user, 'admin')).toBe(false);
  });

  it('user does not satisfy ops', () => {
    expect(hasRole(user, 'ops')).toBe(false);
  });

  it('user satisfies user', () => {
    expect(hasRole(user, 'user')).toBe(true);
  });

  it('admin satisfies admin and user', () => {
    expect(hasRole(admin, 'admin')).toBe(true);
    expect(hasRole(admin, 'user')).toBe(true);
  });

  it('admin does not satisfy ops', () => {
    expect(hasRole(admin, 'ops')).toBe(false);
  });

  it('ops satisfies all roles', () => {
    expect(hasRole(ops, 'ops')).toBe(true);
    expect(hasRole(ops, 'admin')).toBe(true);
    expect(hasRole(ops, 'user')).toBe(true);
  });

  it('null user does not satisfy any role', () => {
    expect(hasRole(null, 'user')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
    expect(hasRole(null, 'ops')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  it('returns 401 when resolveUser returns null', async () => {
    const res = createMockRes();
    const middleware = requireRole(makeProvider(null), 'admin');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {code: 'unauthenticated', message: 'Authentication required'},
    });
    expect(nextCalls).toHaveLength(0);
  });

  it('returns 403 when user role is below minimum', async () => {
    const res = createMockRes();
    const middleware = requireRole(makeProvider({id: 'u1', role: 'user'}), 'admin');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'forbidden',
        message: 'Requires admin role',
        required_role: 'admin',
        current_role: 'user',
      },
    });
    expect(nextCalls).toHaveLength(0);
  });

  it('returns 403 when admin tries to access ops route', async () => {
    const res = createMockRes();
    const middleware = requireRole(makeProvider({id: 'a1', role: 'admin'}), 'ops');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(nextCalls).toHaveLength(0);
  });

  it('calls next() and sets res.locals.user when admin accesses admin route', async () => {
    const user: RuntimeUser = {id: 'a1', role: 'admin'};
    const res = createMockRes();
    const middleware = requireRole(makeProvider(user), 'admin');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(nextCalls).toHaveLength(1);
    expect(nextCalls[0]).toEqual([]); // no error arg
    expect(res.locals['user']).toEqual(user);
  });

  it('calls next() when ops accesses admin route', async () => {
    const user: RuntimeUser = {id: 'o1', role: 'ops'};
    const res = createMockRes();
    const middleware = requireRole(makeProvider(user), 'admin');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(nextCalls).toHaveLength(1);
    expect(res.locals['user']).toEqual(user);
  });

  it('calls next() when user accesses user-level route', async () => {
    const user: RuntimeUser = {id: 'u1', role: 'user'};
    const res = createMockRes();
    const middleware = requireRole(makeProvider(user), 'user');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(nextCalls).toHaveLength(1);
    expect(res.locals['user']).toEqual(user);
  });

  it('forwards RoleProviderError to error handler when resolveUser throws', async () => {
    const provider: RoleProvider = {
      async resolveUser() {
        throw new Error('database connection failed');
      },
    };
    const res = createMockRes();
    const middleware = requireRole(provider, 'admin');
    const {nextCalls} = await runMiddleware(middleware, res);

    expect(nextCalls).toHaveLength(1);
    expect(nextCalls[0]).toHaveLength(1);
    const err = nextCalls[0]?.[0];
    expect(err).toBeInstanceOf(RoleProviderError);
    expect((err as RoleProviderError).code).toBe('role_provider_failed');
    // The original error is preserved as the cause for diagnostics
    expect((err as RoleProviderError).cause).toBeInstanceOf(Error);
    expect(((err as RoleProviderError).cause as Error).message).toBe('database connection failed');
  });

  it('does not write a response body when resolveUser throws', async () => {
    // The middleware passes the error to next() instead of writing a response
    // directly. The actual error sanitization happens in errorHandler.
    const provider: RoleProvider = {
      async resolveUser() {
        throw new Error('SECRET INTERNAL DETAIL');
      },
    };
    const res = createMockRes();
    const middleware = requireRole(provider, 'admin');
    await runMiddleware(middleware, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
