/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreDocument } from '../types';
import { useAmodalContext } from '../provider';

export interface UseStoreListOptions {
  /** Filter by field values (equality match). */
  filter?: Record<string, unknown>;
  /** Sort field. Prefix with "-" for descending (e.g., "-severity"). */
  sort?: string;
  /** Max documents to return. Default: 20. */
  limit?: number;
  /** Auto-refresh interval in milliseconds. Set to 0 to disable. Default: 30000. */
  refreshInterval?: number;
}

export interface UseStoreListReturn {
  /** Array of document payloads. */
  data: Array<Record<string, unknown>>;
  /** Full documents (with key, version, meta). */
  documents: StoreDocument[];
  /** Total count of matching documents. */
  total: number;
  /** Whether more documents exist beyond the current page. */
  hasMore: boolean;
  /** Whether the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message if the fetch failed. */
  error: string | null;
  /** Manually trigger a refetch. */
  refetch: () => void;
}

/**
 * Fetch a list of documents from a store with optional filtering and sorting.
 *
 * @example
 * ```tsx
 * const { data, total } = useStoreList('active-alerts', {
 *   filter: { severity: 'P1' },
 *   sort: '-computedAt',
 *   limit: 10,
 * });
 * ```
 */
export function useStoreList(storeName: string, options: UseStoreListOptions = {}): UseStoreListReturn {
  const { filter, sort, limit = 20, refreshInterval = 30000 } = options;
  const { client } = useAmodalContext();
  const [documents, setDocuments] = useState<StoreDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable stringified deps for filter object
  const filterKey = filter ? JSON.stringify(filter) : '';

  const fetchList = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await client.getStoreDocuments(storeName, {
        filter: filterKey ? JSON.parse(filterKey) : undefined,
        sort,
        limit,
        signal: controller.signal,
      });
      setDocuments(result.documents);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Failed to fetch store list');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [client, storeName, filterKey, sort, limit]);

  const refetch = useCallback(() => {
    void fetchList();
  }, [fetchList]);

  // Initial fetch
  useEffect(() => {
    setIsLoading(true);
    void fetchList();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchList]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const timer = setInterval(() => {
      void fetchList();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [fetchList, refreshInterval]);

  return {
    data: documents.map((d) => d.payload),
    documents,
    total,
    hasMore,
    isLoading,
    error,
    refetch,
  };
}
