/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreDocument, StoreDocumentMeta } from '../types';
import { useAmodalContext } from '../provider';

export interface UseStoreOptions {
  /** Document key to fetch. */
  key: string;
  /** Auto-refresh interval in milliseconds. Set to 0 to disable. Default: 30000. */
  refreshInterval?: number;
}

export interface UseStoreReturn {
  /** Document payload (the entity data). */
  data: Record<string, unknown> | null;
  /** Document metadata (computedAt, ttl, stale, trace, etc.). */
  meta: StoreDocumentMeta | null;
  /** Full document (key, version, payload, meta). */
  document: StoreDocument | null;
  /** Version history (most recent first). */
  history: StoreDocument[];
  /** Whether the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message if the fetch failed. */
  error: string | null;
  /** Manually trigger a refetch. */
  refetch: () => void;
}

/**
 * Fetch a single document from a store by key.
 *
 * @example
 * ```tsx
 * const { data, meta, isLoading } = useStore('deal-health', { key: `deal:${dealId}` });
 * if (data) {
 *   console.log(data.score, data.severity);
 * }
 * ```
 */
export function useStore(storeName: string, options: UseStoreOptions): UseStoreReturn {
  const { key, refreshInterval = 30000 } = options;
  const { client } = useAmodalContext();
  const [document, setDocument] = useState<StoreDocument | null>(null);
  const [history, setHistory] = useState<StoreDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDocument = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await client.getStoreDocument(storeName, key, controller.signal);
      setDocument(result.document);
      setHistory(result.history);
      setError(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Failed to fetch document');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [client, storeName, key]);

  const refetch = useCallback(() => {
    void fetchDocument();
  }, [fetchDocument]);

  // Initial fetch
  useEffect(() => {
    setIsLoading(true);
    void fetchDocument();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchDocument]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const timer = setInterval(() => {
      void fetchDocument();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [fetchDocument, refreshInterval]);

  return {
    data: document?.payload ?? null,
    meta: document?.meta ?? null,
    document,
    history,
    isLoading,
    error,
    refetch,
  };
}
