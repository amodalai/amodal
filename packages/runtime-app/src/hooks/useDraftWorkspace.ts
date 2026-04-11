/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * useDraftWorkspace — thin wrapper around the Studio HTTP API.
 *
 * Replaces the older `useWorkspace` hook for the new draft-workspace editor
 * UI (PR 2.6 of the vercel-shaped refactor). Unlike the old hook, this one:
 *
 *   - does NOT persist anything to localStorage (drafts live server-side),
 *   - does NOT serialize a git bundle,
 *   - does NOT do any restore/lock-tab dance,
 *   - is just a direct mapping from React state to `/api/studio/*` endpoints.
 *
 * All mutating operations refetch the draft list on success so the consumer's
 * change count stays in sync. No optimistic updates yet — the edit-save
 * roundtrip is fast enough in practice, and optimistic state adds a lot of
 * surface area (rollback on error, reconciliation on refetch, etc.) that we
 * can layer on later if needed.
 *
 * Errors are surfaced on the `error` field rather than thrown from the
 * returned methods — this keeps the consumer code ("await save; show error
 * if one") simple without forcing every call site into a try/catch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../utils/log';

// ---------------------------------------------------------------------------
// Types — mirrored from @amodalai/studio's backend contract.
//
// We intentionally inline these rather than importing `@amodalai/studio`
// directly: the studio package pulls in express and other Node-only
// dependencies, and dragging that into the browser bundle would break vite.
// These shapes are the HTTP wire format (not internal backend types), so the
// coupling is only that the server's JSON responses match these interfaces.
// Contract tests in `packages/studio` are the source of truth for the shapes.
// ---------------------------------------------------------------------------

export interface DraftFile {
  /** Repo-relative POSIX path (e.g. `skills/pricing.md`). */
  filePath: string;
  /** Full file contents. */
  content: string;
  /** ISO-8601 timestamp of the last mutation. */
  updatedAt: string;
}

export interface PublishResult {
  commitSha: string;
  commitUrl?: string;
}

export interface PreviewResult {
  snapshotId: string;
  previewToken: string;
  expiresAt: string;
}

/** Type guard for plain-object shapes used when parsing server JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parse a PublishResult from an unknown body, returning null if the shape is wrong. */
function parsePublishResult(body: unknown): PublishResult | null {
  if (!isRecord(body)) return null;
  if (typeof body['commitSha'] !== 'string') return null;
  const commitUrl =
    typeof body['commitUrl'] === 'string' ? body['commitUrl'] : undefined;
  return { commitSha: body['commitSha'], commitUrl };
}

/** Parse a PreviewResult from an unknown body, returning null if the shape is wrong. */
function parsePreviewResult(body: unknown): PreviewResult | null {
  if (!isRecord(body)) return null;
  if (
    typeof body['snapshotId'] !== 'string' ||
    typeof body['previewToken'] !== 'string' ||
    typeof body['expiresAt'] !== 'string'
  ) {
    return null;
  }
  return {
    snapshotId: body['snapshotId'],
    previewToken: body['previewToken'],
    expiresAt: body['expiresAt'],
  };
}

/** Parse a DraftFile[] from an unknown body, returning an empty array on malformed input. */
function parseDraftList(body: unknown): DraftFile[] {
  if (!isRecord(body)) return [];
  const raw = body['drafts'];
  if (!Array.isArray(raw)) return [];
  const out: DraftFile[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (
      typeof item['filePath'] !== 'string' ||
      typeof item['content'] !== 'string' ||
      typeof item['updatedAt'] !== 'string'
    ) {
      continue;
    }
    out.push({
      filePath: item['filePath'],
      content: item['content'],
      updatedAt: item['updatedAt'],
    });
  }
  return out;
}

const log = createLogger('useDraftWorkspace');

/** Base path for the Studio HTTP API. */
const STUDIO_BASE = '/api/studio';

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
 * Error class for failed Studio HTTP calls. Carries `status` (HTTP code) and
 * an optional `code` (the server-side error slug like `feature_unavailable`)
 * so that consumers can pattern-match on them — e.g. the preview button
 * shows a friendlier message for 501 feature_unavailable than for 500.
 */
export class StudioFetchError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'StudioFetchError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Extract a useful error object from a failed fetch. The Studio routes return
 * `{error, message}` JSON on failures — we try to read that shape and fall
 * back to the HTTP status if the body isn't parseable.
 */
async function extractFetchError(res: Response, operation: string): Promise<StudioFetchError> {
  let message = `${operation} failed (${res.status.toString()})`;
  let code: string | undefined;
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      if (typeof body['message'] === 'string') message = body['message'];
      if (typeof body['error'] === 'string') code = body['error'];
    }
  } catch {
    // Body wasn't JSON — keep the default message.
  }
  return new StudioFetchError(message, res.status, code);
}

/**
 * React hook wrapping the Studio HTTP API. See `UseDraftWorkspace` for the
 * returned shape.
 */
export function useDraftWorkspace(): UseDraftWorkspace {
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Track the AbortController for the most recent in-flight request so we can
  // cancel it on unmount. We deliberately only track ONE at a time — if
  // multiple calls overlap, the newer one replaces the older one's controller
  // and the older one completes unchecked (that's fine, it only writes state
  // via the mountedRef guard below).
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

  /**
   * Wrapper that handles the shared "start loading / clear error / catch /
   * finally stop loading" scaffolding for every request. The inner function
   * receives the AbortSignal and returns the parsed result.
   */
  const runRequest = useCallback(
    async <T,>(
      operation: string,
      fn: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | null> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      if (mountedRef.current) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const result = await fn(controller.signal);
        return result;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Unmount or overlapping request — don't surface this as an error.
          return null;
        }
        const wrapped = err instanceof Error ? err : new Error(String(err));
        log.warn('studio_request_failed', { operation, error: wrapped.message });
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
    await runRequest('listDrafts', async (signal) => {
      const res = await fetch(`${STUDIO_BASE}/drafts`, { signal });
      if (!res.ok) throw await extractFetchError(res, 'listDrafts');
      const body: unknown = await res.json();
      const list = parseDraftList(body);
      if (mountedRef.current) setDrafts(list);
      return list;
    });
  }, [runRequest]);

  const saveDraft = useCallback(
    async (filePath: string, content: string): Promise<void> => {
      const ok = await runRequest('saveDraft', async (signal) => {
        const encoded = filePath.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${STUDIO_BASE}/drafts/${encoded}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          signal,
        });
        if (!res.ok) throw await extractFetchError(res, 'saveDraft');
        return true;
      });
      if (ok) await listDrafts();
    },
    [runRequest, listDrafts],
  );

  const deleteDraft = useCallback(
    async (filePath: string): Promise<void> => {
      const ok = await runRequest('deleteDraft', async (signal) => {
        const encoded = filePath.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${STUDIO_BASE}/drafts/${encoded}`, {
          method: 'DELETE',
          signal,
        });
        if (!res.ok) throw await extractFetchError(res, 'deleteDraft');
        return true;
      });
      if (ok) await listDrafts();
    },
    [runRequest, listDrafts],
  );

  const discardAll = useCallback(async (): Promise<void> => {
    const ok = await runRequest('discardAll', async (signal) => {
      const res = await fetch(`${STUDIO_BASE}/discard`, {
        method: 'POST',
        signal,
      });
      if (!res.ok) throw await extractFetchError(res, 'discardAll');
      return true;
    });
    if (ok) await listDrafts();
  }, [runRequest, listDrafts]);

  const publish = useCallback(
    async (commitMessage: string): Promise<PublishResult | null> => {
      const result = await runRequest('publish', async (signal) => {
        const res = await fetch(`${STUDIO_BASE}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitMessage }),
          signal,
        });
        if (!res.ok) throw await extractFetchError(res, 'publish');
        const body: unknown = await res.json();
        const parsed = parsePublishResult(body);
        if (!parsed) throw new Error('publish returned malformed response');
        return parsed;
      });
      if (result) await listDrafts();
      return result;
    },
    [runRequest, listDrafts],
  );

  const buildPreview = useCallback(async (): Promise<PreviewResult | null> => runRequest('buildPreview', async (signal) => {
      const res = await fetch(`${STUDIO_BASE}/preview`, {
        method: 'POST',
        signal,
      });
      if (!res.ok) throw await extractFetchError(res, 'buildPreview');
      const body: unknown = await res.json();
      const parsed = parsePreviewResult(body);
      if (!parsed) throw new Error('buildPreview returned malformed response');
      return parsed;
    }), [runRequest]);

  // Initial fetch on mount.
  useEffect(() => {
    void listDrafts();
    // listDrafts is stable (useCallback) — run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    drafts,
    count: drafts.length,
    isLoading,
    error,
    listDrafts,
    saveDraft,
    deleteDraft,
    discardAll,
    publish,
    buildPreview,
  };
}
