/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryResult } from '../types';
import { useAmodalContext } from '../provider';

export interface UseAmodalQueryOptions {
  /** The query prompt. */
  prompt: string;
  /** Additional context. */
  context?: Record<string, unknown>;
  /** If true, fetched automatically on mount. Defaults to true. */
  autoFetch?: boolean;
}

export type UseAmodalQueryReturn = QueryResult<string> & {
  refetch: () => void;
};

/**
 * Non-streaming query. Collects the full response text.
 */
export function useAmodalQuery(options: UseAmodalQueryOptions): UseAmodalQueryReturn {
  const { prompt, context, autoFetch = true } = options;
  const { client } = useAmodalContext();
  const [data, setData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const fetchQuery = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      let text = '';

      for await (const event of client.chatStream(prompt, { context, signal: controller.signal })) {
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
        switch (event.type) {
          case 'text_delta':
            text += event.content;
            break;
          case 'error':
            setError(event.message);
            break;
          default:
            break;
        }
      }

      setData(text);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [client, prompt, context]);

  const refetch = useCallback(() => {
    void fetchQuery();
  }, [fetchQuery]);

  useEffect(() => {
    if (autoFetch && !mountedRef.current) {
      mountedRef.current = true;
      void fetchQuery();
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [autoFetch, fetchQuery]);

  return { data, isLoading, error, refetch };
}
