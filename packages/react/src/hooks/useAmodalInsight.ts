/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InsightResult } from '../types';
import { useAmodalContext } from '../provider';

export interface UseAmodalInsightOptions {
  /** The insight prompt to send. */
  prompt: string;
  /** Additional context for the insight. */
  context?: Record<string, unknown>;
  /** If true, fetched automatically on mount. Defaults to true. */
  autoFetch?: boolean;
}

export interface UseAmodalInsightReturn {
  status: InsightResult['status'];
  summary: string;
  details: string;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Sends a chat with an insight prompt, collects a structured response.
 * Splits the response at the first double newline into summary and details.
 */
export function useAmodalInsight(options: UseAmodalInsightOptions): UseAmodalInsightReturn {
  const { prompt, context, autoFetch = true } = options;
  const { client } = useAmodalContext();
  const [status, setStatus] = useState<InsightResult['status']>('idle');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const fetchInsight = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    setSummary('');
    setDetails('');

    try {
      let text = '';

      for await (const event of client.chatStream(prompt, { context, signal: controller.signal })) {
        switch (event.type) {
          case 'text_delta':
            text += event.content;
            break;
          case 'error':
            setError(event.message);
            setStatus('error');
            return;
          default:
            break;
        }
      }

      // Split at first double newline
      const splitIndex = text.indexOf('\n\n');
      if (splitIndex >= 0) {
        setSummary(text.slice(0, splitIndex).trim());
        setDetails(text.slice(splitIndex + 2).trim());
      } else {
        setSummary(text.trim());
      }
      setStatus('done');
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [client, prompt, context]);

  const refresh = useCallback(() => {
    void fetchInsight();
  }, [fetchInsight]);

  useEffect(() => {
    if (autoFetch && !mountedRef.current) {
      mountedRef.current = true;
      void fetchInsight();
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [autoFetch, fetchInsight]);

  return { status, summary, details, isLoading: status === 'loading', error, refresh };
}
