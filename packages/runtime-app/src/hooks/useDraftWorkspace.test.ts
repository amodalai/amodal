/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for useDraftWorkspace. We mock `globalThis.fetch` directly rather
 * than introducing MSW — runtime-app's existing hook tests (see useMe)
 * follow the same pattern and there's no point diverging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDraftWorkspace, StudioFetchError, type DraftFile } from './useDraftWorkspace';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

const sampleDrafts: DraftFile[] = [
  { filePath: 'skills/a.md', content: 'A', updatedAt: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useDraftWorkspace', () => {
  it('fetches drafts on mount', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ drafts: sampleDrafts }),
    );

    const { result } = renderHook(() => useDraftWorkspace());

    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });
    expect(result.current.count).toBe(1);
    expect(result.current.error).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/studio/drafts',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('stores an Error when the initial fetch fails', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'boom' }, 500),
    );

    const { result } = renderHook(() => useDraftWorkspace());

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.drafts).toEqual([]);
  });

  it('saveDraft PUTs JSON then refetches drafts', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // 1. initial list
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: [] }));
    // 2. PUT save
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    // 3. refetch
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));

    const { result } = renderHook(() => useDraftWorkspace());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.saveDraft('skills/a.md', 'A');
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    // Verify the PUT call shape.
    const putCall = fetchMock.mock.calls[1];
    expect(putCall[0]).toBe('/api/studio/drafts/skills/a.md');
    const putInit = putCall[1] as RequestInit;
    expect(putInit.method).toBe('PUT');
    expect(putInit.body).toBe(JSON.stringify({ content: 'A' }));
    expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deleteDraft DELETEs and refetches', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: [] }));

    const { result } = renderHook(() => useDraftWorkspace());
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    await act(async () => {
      await result.current.deleteDraft('skills/a.md');
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual([]);
    });

    const deleteCall = fetchMock.mock.calls[1];
    expect(deleteCall[0]).toBe('/api/studio/drafts/skills/a.md');
    expect((deleteCall[1] as RequestInit).method).toBe('DELETE');
  });

  it('discardAll POSTs and refetches', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok', count: 1 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: [] }));

    const { result } = renderHook(() => useDraftWorkspace());
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    await act(async () => {
      await result.current.discardAll();
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual([]);
    });

    expect(fetchMock.mock.calls[1][0]).toBe('/api/studio/discard');
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
  });

  it('publish POSTs the commit message and returns the result', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ commitSha: 'abc1234' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: [] }));

    const { result } = renderHook(() => useDraftWorkspace());
    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });

    let publishResult: Awaited<ReturnType<typeof result.current.publish>> = null;
    await act(async () => {
      publishResult = await result.current.publish('fix typo');
    });
    expect(publishResult).toEqual({ commitSha: 'abc1234' });

    const publishCall = fetchMock.mock.calls[1];
    expect(publishCall[0]).toBe('/api/studio/publish');
    expect((publishCall[1] as RequestInit).body).toBe(JSON.stringify({ commitMessage: 'fix typo' }));
  });

  it('buildPreview POSTs and returns the preview result', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshotId: 'snap-1',
        previewToken: 'tok-xyz',
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    );

    const { result } = renderHook(() => useDraftWorkspace());
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

  it('stores error status code from failed preview for 501 handling', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'feature_unavailable', message: 'not yet' }, 501),
    );

    const { result } = renderHook(() => useDraftWorkspace());
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

  it('aborts in-flight requests on unmount', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise<Response>(() => {
        // never resolves — we're testing abort
      });
    });

    const { unmount } = renderHook(() => useDraftWorkspace());
    // Give the effect a tick to start the fetch.
    await waitFor(() => {
      expect(capturedSignal).toBeDefined();
    });

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('swallows empty-response errors on successful operations', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: [] }));
    // HEAD-style empty body on save — unlikely for Studio, but should not crash.
    fetchMock.mockResolvedValueOnce(emptyResponse(200));
    fetchMock.mockResolvedValueOnce(jsonResponse({ drafts: sampleDrafts }));

    const { result } = renderHook(() => useDraftWorkspace());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.saveDraft('skills/a.md', 'A');
    });

    await waitFor(() => {
      expect(result.current.drafts).toEqual(sampleDrafts);
    });
    expect(result.current.error).toBeNull();
  });
});
