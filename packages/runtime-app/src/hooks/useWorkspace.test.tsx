/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the workspace editing hook.
 *
 * Covers the bugs that the standards review caught:
 *  - discard() must throw on server failure and NOT clear localStorage
 *  - saveToLocalStorage must surface quota errors as a warning
 *  - restore() must throw WorkspaceError on 409 (stale base)
 *  - All fetches must time out instead of hanging
 *  - persist() must validate response shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspace, WorkspaceError, type WorkspaceState } from './useWorkspace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_ID = 'app-test';
const STORAGE_KEY = `amodal:workspace:${APP_ID}`;
const PLATFORM_URL = 'https://platform.test';

const HOSTED_CONFIG_RESPONSE = {
  workspace: {
    enabled: true,
    baseCommitSha: 'base-sha-1',
    baseBranchName: 'main',
    platformApiUrl: PLATFORM_URL,
    appId: APP_ID,
  },
};

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockEmptyResponse(status: number): Response {
  return new Response(null, { status });
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

interface FetchMockOptions {
  /** Maps URL → response. URL match is substring. */
  routes: Record<string, () => Response | Promise<Response>>;
}

function setupFetchMock(opts: FetchMockOptions): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    const route = Object.keys(opts.routes).find((key) => url.includes(key));
    if (!route) {
      throw new Error(`Unmocked fetch: ${method} ${url}`);
    }
    return opts.routes[route]();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest mock signature
  globalThis.fetch = fetchMock as any;
  return { calls };
}

/**
 * Wait for the hook to finish its initial mount effect (config fetch + restore).
 */
async function waitForReady(result: { current: WorkspaceState | null }): Promise<void> {
  await waitFor(() => {
    expect(result.current?.ready).toBe(true);
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

describe('useWorkspace - mode detection', () => {
  it('returns inert state when /api/config has no workspace field', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse({ name: 'My Agent' }),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);
    expect(result.current).not.toBeNull();
    expect(result.current?.isDirty).toBe(false);
    expect(result.current?.stored).toBeNull();
  });

  it('initializes when /api/config has workspace.enabled', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);
    expect(result.current).not.toBeNull();
  });

  it('treats 500 from /api/config as not-hosted-mode (no crash)', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockEmptyResponse(500),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);
    expect(result.current?.stored).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onFileSaved → localStorage
// ---------------------------------------------------------------------------

describe('useWorkspace - onFileSaved', () => {
  it('stores workspace data in localStorage', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? '{}');
    expect(stored.headSha).toBe('commit-1');
    expect(stored.commits).toHaveLength(1);
    expect(result.current?.isDirty).toBe(true);
  });

  it('surfaces quota_exceeded as a warning instead of silently failing', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
      },
    });
    // Simulate localStorage quota exceeded.
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });

    // Warning should be set
    expect(result.current?.warning).toMatch(/storage is full/i);
    // In-memory state still updated so the UI reflects the edit during this session
    expect(result.current?.isDirty).toBe(true);

    setItemSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// discard()
// ---------------------------------------------------------------------------

describe('useWorkspace - discard', () => {
  it('clears localStorage when server reset succeeds', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/reset': () => mockJsonResponse({ reset: true }),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    // Seed localStorage with a pending edit
    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      await result.current?.discard();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current?.stored).toBeNull();
  });

  it('throws WorkspaceError and does NOT clear localStorage when server reset fails', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/reset': () => mockEmptyResponse(500),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    // Seed localStorage with a pending edit
    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });
    const beforeRaw = localStorage.getItem(STORAGE_KEY);
    expect(beforeRaw).not.toBeNull();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.discard();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).kind).toBe('reset_failed');

    // localStorage should NOT have been cleared — this is the data inconsistency bug
    expect(localStorage.getItem(STORAGE_KEY)).toBe(beforeRaw);
    expect(result.current?.isDirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// restore()
// ---------------------------------------------------------------------------

describe('useWorkspace - restore', () => {
  it('throws WorkspaceError with restore_stale on 409', async () => {
    // Pre-seed localStorage so the hook has something to restore on mount
    const existing = {
      baseCommitSha: 'old-base',
      baseBranchName: 'main',
      headSha: 'commit-1',
      bundle: 'YmFzZTY0',
      commits: [
        { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
      ],
      lastModified: '2026-01-01T00:00:00Z',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/restore': () => mockEmptyResponse(409),
      },
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.restore();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).kind).toBe('restore_stale');
  });

  it('throws WorkspaceError with restore_failed on 500', async () => {
    const existing = {
      baseCommitSha: 'base-sha-1',
      baseBranchName: 'main',
      headSha: 'commit-1',
      bundle: 'YmFzZTY0',
      commits: [
        { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
      ],
      lastModified: '2026-01-01T00:00:00Z',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/restore': () => mockEmptyResponse(500),
      },
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.restore();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).kind).toBe('restore_failed');
  });
});

// ---------------------------------------------------------------------------
// persist()
// ---------------------------------------------------------------------------

describe('useWorkspace - persist', () => {
  it('throws no_changes WorkspaceError when nothing to persist', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.persist();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).kind).toBe('no_changes');
  });

  it('re-anchors workspace after successful persist', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/repos/': () => mockJsonResponse({
          branch: 'config/app-test-12345',
          headCommit: 'new-head-sha',
          commitCount: 2,
        }),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });

    let persistResult: { branch: string; headCommit: string; commitCount: number } | undefined;
    await act(async () => {
      persistResult = await result.current?.persist();
    });

    expect(persistResult?.branch).toBe('config/app-test-12345');
    expect(persistResult?.headCommit).toBe('new-head-sha');

    // After re-anchor: stored.baseCommitSha should be the new head, no pending commits
    expect(result.current?.stored?.baseCommitSha).toBe('new-head-sha');
    expect(result.current?.stored?.commits).toEqual([]);
    expect(result.current?.persistedBranch).toBe('config/app-test-12345');
    expect(result.current?.isDirty).toBe(false);
  });

  it('throws persist_failed when response is missing required fields', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/repos/': () => mockJsonResponse({
          // missing headCommit and commitCount
          branch: 'config/app-test-12345',
        }),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.persist();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).kind).toBe('persist_failed');
  });

  it('extracts error message from non-OK persist response body', async () => {
    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/repos/': () => mockJsonResponse({ message: 'base outdated' }, 409),
      },
    });
    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    act(() => {
      result.current?.onFileSaved({
        commit: { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        bundle: 'YmFzZTY0YnVuZGxl',
        commits: [
          { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
        ],
      });
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current?.persist();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as Error).message).toContain('base outdated');
  });
});

// ---------------------------------------------------------------------------
// Stale detection
// ---------------------------------------------------------------------------

describe('useWorkspace - stale detection', () => {
  it('marks workspace as stale when stored base differs from config base', async () => {
    const existing = {
      baseCommitSha: 'old-base',
      baseBranchName: 'main',
      headSha: 'commit-1',
      bundle: 'YmFzZTY0',
      commits: [
        { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
      ],
      lastModified: '2026-01-01T00:00:00Z',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        // Restore on mount returns 200 — staleness is detected client-side from baseCommitSha
        '/api/workspace/restore': () => mockJsonResponse({ restored: true, head: 'commit-1', commits: [] }),
      },
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    expect(result.current?.isStale).toBe(true);
  });

  it('does not mark as stale when stored base matches config base', async () => {
    const existing = {
      baseCommitSha: 'base-sha-1', // matches HOSTED_CONFIG_RESPONSE
      baseBranchName: 'main',
      headSha: 'commit-1',
      bundle: 'YmFzZTY0',
      commits: [
        { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
      ],
      lastModified: '2026-01-01T00:00:00Z',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/restore': () => mockJsonResponse({ restored: true, head: 'commit-1', commits: [] }),
      },
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    expect(result.current?.isStale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bundle size warning
// ---------------------------------------------------------------------------

describe('useWorkspace - bundle size warning', () => {
  it('warns when bundle exceeds 4MB', async () => {
    // 4.5MB of base64 chars
    const largeBundle = 'A'.repeat(4.5 * 1024 * 1024);
    const existing = {
      baseCommitSha: 'base-sha-1',
      baseBranchName: 'main',
      headSha: 'commit-1',
      bundle: largeBundle,
      commits: [
        { sha: 'commit-1', message: 'edit', files: ['skills/a.md'], timestamp: '2026-01-01' },
      ],
      lastModified: '2026-01-01T00:00:00Z',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    setupFetchMock({
      routes: {
        '/api/config': () => mockJsonResponse(HOSTED_CONFIG_RESPONSE),
        '/api/workspace/restore': () => mockJsonResponse({ restored: true, head: 'commit-1', commits: [] }),
      },
    });

    const { result } = renderHook(() => useWorkspace());
    await waitForReady(result);

    expect(result.current?.warning).toMatch(/4\.5MB/);
  });
});
