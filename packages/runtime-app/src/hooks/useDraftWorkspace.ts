/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * useDraftWorkspace — thin wrapper around the StudioClient from
 * `@amodalai/studio-client`.
 *
 * Replaces the older direct-fetch implementation. The transport layer is
 * now handled by `createStudioClient`; this hook manages React state
 * (loading, error, draft list) and coordinates refetches after mutations.
 *
 * The Studio URL is resolved from `StudioContext`, which fetches it from
 * the runtime's `GET /api/context` endpoint on mount.
 *
 * All mutating operations refetch the draft list on success so the
 * consumer's change count stays in sync.
 *
 * Errors are surfaced on the `error` field rather than thrown from the
 * returned methods.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createStudioClient,
  StudioFetchError,
  StudioResponseParseError,
} from '@amodalai/studio-client';
import type {
  DraftFile,
  PublishResult,
  PreviewResult,
  StudioClient,
} from '@amodalai/studio-client';
import { useStudioContext } from '../contexts/StudioContext';
import { createLogger } from '../utils/log';

// Re-export types and error classes so existing consumers don't break.
export { StudioFetchError, StudioResponseParseError };
export type { DraftFile, PublishResult, PreviewResult };

const log = createLogger('useDraftWorkspace');

/** Public return shape for consumers. */
export interface UseDraftWorkspace {
  /** Current list of drafts (empty array until the first fetch completes). */
  drafts: DraftFile[];
  /** Shortcut for `drafts.length` — the "N unpublished changes" number. */
  count: number;
  /** True while any request (list / save / delete / discard / publish / preview) is in flight. */
  isLoading: boolean;
  /** Most recent error from any operation, or null. Cleared on next successful call. */
  error: Error | null;
  /**
   * Synchronously read the most recent error. This is a ref-based getter and
   * reflects the current value even inside an async callback that has not
   * yet seen the React re-render triggered by `setError`. Callers that need
   * to inspect the error *immediately after* awaiting a mutation — e.g. to
   * distinguish a 501 feature-unavailable from a generic failure — should
   * use this instead of reading `error` from the closure, which is captured
   * from the render that scheduled the mutation and is therefore stale.
   */
  getLatestError: () => Error | null;
  /** Refetch the draft list. Called internally by the mutations. */
  listDrafts: () => Promise<void>;
  /** Save (upsert) a draft file. Refetches on success. */
  saveDraft: (filePath: string, content: string) => Promise<void>;
  /** Delete (revert) a single draft file. Refetches on success. */
  deleteDraft: (filePath: string) => Promise<void>;
  /** Discard every draft in one call. Refetches on success. */
  discardAll: () => Promise<void>;
  /** Publish staged drafts as one commit. Returns the result on success. */
  publish: (commitMessage: string) => Promise<PublishResult | null>;
  /** Build a preview snapshot. Returns the result on success. */
  buildPreview: () => Promise<PreviewResult | null>;
}

/**
 * React hook wrapping the Studio HTTP API via `@amodalai/studio-client`.
 * See `UseDraftWorkspace` for the returned shape.
 *
 * When the Studio URL is not yet resolved (loading from /api/context) or
 * not configured (null), the hook returns a loading/disabled state with
 * no-op mutations.
 */
export function useDraftWorkspace(): UseDraftWorkspace {
  const { studioUrl, loading: contextLoading } = useStudioContext();

  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Mirror of `error` kept in a ref so callbacks can read the latest value
  // synchronously. See the `getLatestError` JSDoc on UseDraftWorkspace.
  const errorRef = useRef<Error | null>(null);

  // Track the AbortController for the most recent in-flight request so we can
  // cancel it on unmount.
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef<boolean>(true);

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

  // Create the StudioClient instance whenever the URL changes.
  const client: StudioClient | null = useMemo(() => {
    if (!studioUrl) return null;
    return createStudioClient({ baseUrl: studioUrl });
  }, [studioUrl]);

  /**
   * Wrapper that handles the shared "start loading / clear error / catch /
   * finally stop loading" scaffolding for every request.
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

  const listDrafts = useCallback(async (): Promise<void> => {
    if (!client) return;
    await runRequest('listDrafts', async () => {
      const list = await client.listDrafts();
      if (mountedRef.current) setDrafts(list);
      return list;
    });
  }, [client, runRequest]);

  const saveDraft = useCallback(
    async (filePath: string, content: string): Promise<void> => {
      if (!client) return;
      const ok = await runRequest('saveDraft', async () => {
        await client.saveDraft(filePath, content);
        return true;
      });
      if (ok) await listDrafts();
    },
    [client, runRequest, listDrafts],
  );

  const deleteDraft = useCallback(
    async (filePath: string): Promise<void> => {
      if (!client) return;
      const ok = await runRequest('deleteDraft', async () => {
        await client.deleteDraft(filePath);
        return true;
      });
      if (ok) await listDrafts();
    },
    [client, runRequest, listDrafts],
  );

  const discardAll = useCallback(async (): Promise<void> => {
    if (!client) return;
    const ok = await runRequest('discardAll', async () => {
      await client.discardAll();
      return true;
    });
    if (ok) await listDrafts();
  }, [client, runRequest, listDrafts]);

  const publish = useCallback(
    async (commitMessage: string): Promise<PublishResult | null> => {
      if (!client) return null;
      const result = await runRequest('publish', async () => client.publish(commitMessage));
      if (result) await listDrafts();
      return result;
    },
    [client, runRequest, listDrafts],
  );

  const buildPreview = useCallback(
    async (): Promise<PreviewResult | null> => {
      if (!client) return null;
      return runRequest('buildPreview', async () => client.buildPreview());
    },
    [client, runRequest],
  );

  // Initial fetch once the studio client is available.
  useEffect(() => {
    if (client) {
      void listDrafts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const getLatestError = useCallback((): Error | null => errorRef.current, []);

  return {
    drafts,
    count: drafts.length,
    isLoading: isLoading || contextLoading,
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
