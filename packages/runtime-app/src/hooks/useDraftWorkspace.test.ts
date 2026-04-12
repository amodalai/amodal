/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for useDraftWorkspace. The hook now delegates to `@amodalai/studio-client`
 * and reads the Studio URL from StudioContext. We mock `globalThis.fetch` so
 * the StudioClient's internal fetch calls are intercepted, and wrap the hook
 * in a StudioProvider that gets its URL from a mocked /api/context response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import {
  useDraftWorkspace,
  StudioFetchError,
  type DraftFile,
} from './useDraftWorkspace';
import { StudioProvider } from '../contexts/StudioContext';

const STUDIO_URL = 'http://localhost:3848';
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleDrafts: DraftFile[] = [
  { filePath: 'skills/a.md', content: 'A', updatedAt: '2026-01-01T00:00:00Z' },
];

/**
 * Build a fetch mock that handles the /api/context call first (returning the
 * Studio URL), then delegates subsequent calls to the provided implementations.
 */
function buildFetchMock(...handlers: Array<(url: string, init?: RequestInit) => Promise<Response>>): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    // First call is always /api/context from StudioProvider
    if (url === '/api/context') {
      return Promise.resolve(jsonResponse({ studioUrl: STUDIO_URL, adminAgentUrl: null }));
    }
    const handler = handlers[callIndex];
    callIndex++;
    if (handler) {
      return handler(url, init);
    }
    return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500));
  });
}

/** Wrapper that provides StudioContext to the hook under test. */
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(StudioProvider, null, children);
}

beforeEach(() => {
  // Default: no-op fetch; individual tests override via buildFetchMock
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useDraftWorkspace', () => {
  it('fetches drafts on mount after StudioContext resolves', async () => {
    globalThis.fetch = buildFetchMock(
      // listDrafts — server returns { drafts: [...] }
      async () => jsonResponse({ drafts: sampleDrafts }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });
    expect(result.current.count).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('stores an Error when the initial fetch fails', async () => {
    globalThis.fetch = buildFetchMock(
      // listDrafts returns 500
      async () => jsonResponse({ error: 'internal_error', message: 'boom' }, 500),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.drafts).toEqual([]);
  });

  it('saveDraft calls client then refetches drafts', async () => {
    globalThis.fetch = buildFetchMock(
      // 1. initial listDrafts
      async () => jsonResponse({ drafts: [] }),
      // 2. saveDraft PUT
      async () => jsonResponse({ status: 'ok' }),
      // 3. refetch listDrafts
      async () => jsonResponse({ drafts: sampleDrafts }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.saveDraft('skills/a.md', 'A');
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });
  });

  it('deleteDraft calls client then refetches', async () => {
    globalThis.fetch = buildFetchMock(
      // 1. initial listDrafts
      async () => jsonResponse({ drafts: sampleDrafts }),
      // 2. deleteDraft DELETE
      async () => jsonResponse({ status: 'ok' }),
      // 3. refetch listDrafts
      async () => jsonResponse({ drafts: [] }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    await act(async () => {
      await result.current.deleteDraft('skills/a.md');
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual([]);
    });
  });

  it('discardAll calls client then refetches', async () => {
    globalThis.fetch = buildFetchMock(
      async () => jsonResponse({ drafts: sampleDrafts }),
      async () => jsonResponse({ status: 'ok' }),
      async () => jsonResponse({ drafts: [] }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    await act(async () => {
      await result.current.discardAll();
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual([]);
    });
  });

  it('publish calls client and returns the result', async () => {
    globalThis.fetch = buildFetchMock(
      async () => jsonResponse({ drafts: sampleDrafts }),
      async () => jsonResponse({ commitSha: 'abc1234' }),
      async () => jsonResponse({ drafts: [] }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    let publishResult: Awaited<ReturnType<typeof result.current.publish>> = null;
    await act(async () => {
      publishResult = await result.current.publish('fix typo');
    });
    expect(publishResult).toEqual({ commitSha: 'abc1234' });
  });

  it('buildPreview calls client and returns the preview result', async () => {
    globalThis.fetch = buildFetchMock(
      async () => jsonResponse({ drafts: sampleDrafts }),
      async () =>
        jsonResponse({
          snapshotId: 'snap-1',
          previewToken: 'tok-xyz',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    let previewResult: Awaited<ReturnType<typeof result.current.buildPreview>> = null;
    await act(async () => {
      previewResult = await result.current.buildPreview();
    });
    expect(previewResult).not.toBeNull();
    expect(previewResult!.previewToken).toBe('tok-xyz');
  });

  it('stores error with status code from failed preview for 501 handling', async () => {
    globalThis.fetch = buildFetchMock(
      async () => jsonResponse({ drafts: sampleDrafts }),
      // buildPreview returns 501
      async () => jsonResponse({ error: 'feature_unavailable', message: 'not yet' }, 501),
    );

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    await act(async () => {
      await result.current.buildPreview();
    });

    expect(result.current.error).toBeInstanceOf(StudioFetchError);
    const err = result.current.error;
    expect(err instanceof StudioFetchError && err.status).toBe(501);
  });

  it('returns loading state when StudioContext has no URL', async () => {
    // Mock /api/context to return no studioUrl
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/context') {
        return jsonResponse({ studioUrl: null, adminAgentUrl: null });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const { result } = renderHook(() => useDraftWorkspace(), { wrapper });

    // Wait for context to resolve
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No drafts fetched since there's no studio URL
    expect(result.current.drafts).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
