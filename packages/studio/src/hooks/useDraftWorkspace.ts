/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * useDraftWorkspace — simplified hook for same-origin Studio draft operations.
 *
 * Unlike the runtime-app version which goes through StudioContext and
 * @amodalai/studio-client, this hook calls the Studio API directly since
 * we're already inside the Studio app (same-origin fetch).
 *
 * All mutating operations refetch the draft list on success so the
 * consumer's change count stays in sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftFile, PublishResult, PreviewResult } from '@/lib/types';
import { studioApiUrl } from '@/lib/api';
import { createBrowserLogger } from '@/lib/browser-logger';

const log = createBrowserLogger('useDraftWorkspace');

// ---------------------------------------------------------------------------
// API route constants
// ---------------------------------------------------------------------------

const DRAFTS_API_PATH = '/api/drafts';
const DISCARD_API_PATH = '/api/discard';
const PUBLISH_API_PATH = '/api/publish';
const PREVIEW_API_PATH = '/api/preview';

// ---------------------------------------------------------------------------
// Error class for fetch failures
// ---------------------------------------------------------------------------

export class StudioFetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'StudioFetchError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Public return shape for consumers. */
export interface UseDraftWorkspace {
  drafts: DraftFile[];
  count: number;
  isLoading: boolean;
  error: Error | null;
  getLatestError: () => Error | null;
  listDrafts: () => Promise<void>;
  saveDraft: (filePath: string, content: string) => Promise<void>;
  deleteDraft: (filePath: string) => Promise<void>;
  discardAll: () => Promise<void>;
  publish: (commitMessage: string) => Promise<PublishResult | null>;
  buildPreview: () => Promise<PreviewResult | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDraftWorkspace(): UseDraftWorkspace {
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const errorRef = useRef<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, []);

  /**
   * Shared request wrapper: sets loading state, clears errors, catches
   * failures, and records them on the error field.
   */
  const runRequest = useCallback(
    async <T,>(
      operation: string,
      fn: () => Promise<T>,
    ): Promise<T | null> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      errorRef.current = null;
      if (mountedRef.current) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const result = await fn();
        return result;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }
        const wrapped = err instanceof Error ? err : new Error(String(err));
        log.warn('studio_request_failed', { operation, error: wrapped.message });
        errorRef.current = wrapped;
        if (mountedRef.current) {
          setError(wrapped);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [],
  );

  /**
   * Helper to make a fetch call and handle non-OK responses.
   */
  async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      signal: controllerRef.current?.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new StudioFetchError(response.status, `${response.status}: ${body}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON parse boundary, validated by caller
    return response.json() as Promise<T>;
  }

  const listDrafts = useCallback(async (): Promise<void> => {
    await runRequest('listDrafts', async () => {
      const response = await apiFetch<{ drafts: DraftFile[] }>(studioApiUrl(DRAFTS_API_PATH));
      if (mountedRef.current) setDrafts(response.drafts);
      return response.drafts;
    });
  }, [runRequest]);

  const saveDraft = useCallback(
    async (filePath: string, content: string): Promise<void> => {
      const ok = await runRequest('saveDraft', async () => {
        await apiFetch<unknown>(studioApiUrl(`${DRAFTS_API_PATH}/${encodeURIComponent(filePath)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        return true;
      });
      if (ok) await listDrafts();
    },
    [runRequest, listDrafts],
  );

  const deleteDraft = useCallback(
    async (filePath: string): Promise<void> => {
      const ok = await runRequest('deleteDraft', async () => {
        await apiFetch<unknown>(studioApiUrl(`${DRAFTS_API_PATH}/${encodeURIComponent(filePath)}`), {
          method: 'DELETE',
        });
        return true;
      });
      if (ok) await listDrafts();
    },
    [runRequest, listDrafts],
  );

  const discardAll = useCallback(async (): Promise<void> => {
    const ok = await runRequest('discardAll', async () => {
      await apiFetch<unknown>(studioApiUrl(DISCARD_API_PATH), { method: 'POST' });
      return true;
    });
    if (ok) await listDrafts();
  }, [runRequest, listDrafts]);

  const publish = useCallback(
    async (commitMessage: string): Promise<PublishResult | null> => {
      const result = await runRequest('publish', async () =>
        apiFetch<PublishResult>(studioApiUrl(PUBLISH_API_PATH), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitMessage }),
        }),
      );
      if (result) await listDrafts();
      return result;
    },
    [runRequest, listDrafts],
  );

  const buildPreview = useCallback(
    async (): Promise<PreviewResult | null> =>
      runRequest('buildPreview', async () =>
        apiFetch<PreviewResult>(studioApiUrl(PREVIEW_API_PATH), { method: 'POST' }),
      ),
    [runRequest],
  );

  // Initial fetch on mount.
  useEffect(() => {
    void listDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getLatestError = useCallback((): Error | null => errorRef.current, []);

  return {
    drafts,
    count: drafts.length,
    isLoading,
    error,
    getLatestError,
    listDrafts,
    saveDraft,
    deleteDraft,
    discardAll,
    publish,
    buildPreview,
  };
}
