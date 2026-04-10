/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the useMe hook.
 *
 * Verifies that:
 *  - 200 with a valid body sets user to {id, role}
 *  - 401 sets user to null
 *  - non-OK / network error / invalid shape all fail closed (user: null)
 *  - hasRole correctly compares privilege levels
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMe, hasRole, type RuntimeUser } from './useMe';

// Capture the original fetch so we can restore it after each test.
// Tests assign directly to globalThis.fetch and vi.restoreAllMocks() does not
// reset that — without explicit cleanup a leaked fetch mock would silently
// affect subsequent tests.
const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockEmptyResponse(status: number): Response {
  return new Response(null, { status });
}

function setupFetchMock(handler: () => Response | Promise<Response>): { calls: number } {
  const stats = { calls: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes('/api/me')) {
      throw new Error(`Unmocked fetch: ${url}`);
    }
    stats.calls += 1;
    return handler();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest mock signature
  globalThis.fetch = fetchMock as any;
  return stats;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// hasRole
// ---------------------------------------------------------------------------

describe('hasRole', () => {
  const user: RuntimeUser = { id: 'u1', role: 'user' };
  const admin: RuntimeUser = { id: 'a1', role: 'admin' };
  const ops: RuntimeUser = { id: 'o1', role: 'ops' };

  it('user satisfies user', () => {
    expect(hasRole(user, 'user')).toBe(true);
  });

  it('user does not satisfy admin or ops', () => {
    expect(hasRole(user, 'admin')).toBe(false);
    expect(hasRole(user, 'ops')).toBe(false);
  });

  it('admin satisfies admin and user but not ops', () => {
    expect(hasRole(admin, 'user')).toBe(true);
    expect(hasRole(admin, 'admin')).toBe(true);
    expect(hasRole(admin, 'ops')).toBe(false);
  });

  it('ops satisfies all roles', () => {
    expect(hasRole(ops, 'user')).toBe(true);
    expect(hasRole(ops, 'admin')).toBe(true);
    expect(hasRole(ops, 'ops')).toBe(true);
  });

  it('null user does not satisfy any role', () => {
    expect(hasRole(null, 'user')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
    expect(hasRole(null, 'ops')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useMe
// ---------------------------------------------------------------------------

describe('useMe', () => {
  it('returns user with role on a successful fetch', async () => {
    setupFetchMock(() => mockJsonResponse({ id: 'local-dev', role: 'ops' }));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toEqual({ id: 'local-dev', role: 'ops' });
  });

  it('returns null user on 401', async () => {
    setupFetchMock(() => mockEmptyResponse(401));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toBeNull();
  });

  it('returns null user on 500 (fail closed)', async () => {
    setupFetchMock(() => mockEmptyResponse(500));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toBeNull();
  });

  it('returns null user when fetch throws (network error)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest mock signature
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); }) as any;
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toBeNull();
  });

  it('returns null user when response shape is invalid', async () => {
    setupFetchMock(() => mockJsonResponse({ id: 'x' })); // missing role
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toBeNull();
  });

  it('returns null user when role is not a known value', async () => {
    setupFetchMock(() => mockJsonResponse({ id: 'x', role: 'superuser' }));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toBeNull();
  });

  it('parses admin role correctly', async () => {
    setupFetchMock(() => mockJsonResponse({ id: 'sally@acme.com', role: 'admin' }));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toEqual({ id: 'sally@acme.com', role: 'admin' });
  });

  it('parses user role correctly', async () => {
    setupFetchMock(() => mockJsonResponse({ id: 'end-user', role: 'user' }));
    const { result } = renderHook(() => useMe());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.user).toEqual({ id: 'end-user', role: 'user' });
  });

  it('starts with ready=false before fetch resolves', () => {
    setupFetchMock(() => new Promise(() => { /* never resolves */ }));
    const { result } = renderHook(() => useMe());
    expect(result.current.ready).toBe(false);
    expect(result.current.user).toBeNull();
  });
});
