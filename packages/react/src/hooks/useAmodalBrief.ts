/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BriefResult, ToolCallInfo } from '../types';
import { useAmodalContext } from '../provider';

export interface UseAmodalBriefOptions {
  /** The prompt to send for the brief. */
  prompt: string;
  /** Additional context sent with the request. */
  context?: Record<string, unknown>;
  /** If true, the brief is fetched automatically on mount. Defaults to true. */
  autoFetch?: boolean;
}

export interface UseAmodalBriefReturn {
  brief: BriefResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Sends a chat with a brief prompt, collects the full response.
 */
export function useAmodalBrief(options: UseAmodalBriefOptions): UseAmodalBriefReturn {
  const { prompt, context, autoFetch = true } = options;
  const { client } = useAmodalContext();
  const [brief, setBrief] = useState<BriefResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const fetchBrief = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      let text = '';
      const toolCalls: ToolCallInfo[] = [];

      for await (const event of client.chatStream(prompt, { context, signal: controller.signal })) {
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
        switch (event.type) {
          case 'text_delta':
            text += event.content;
            break;
          case 'tool_call_start':
            toolCalls.push({
              toolId: event.tool_id,
              toolName: event.tool_name,
              parameters: event.parameters,
              status: 'running',
            });
            break;
          case 'tool_call_result': {
            const tc = toolCalls.find((t) => t.toolId === event.tool_id);
            if (tc) {
              tc.status = event.status;
              tc.result = event.result;
              tc.duration_ms = event.duration_ms;
              tc.error = event.error;
            }
            break;
          }
          case 'error':
            setError(event.message);
            break;
          default:
            break;
        }
      }

      setBrief({ text, toolCalls });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [client, prompt, context]);

  const refresh = useCallback(() => {
    void fetchBrief();
  }, [fetchBrief]);

  useEffect(() => {
    if (autoFetch && !mountedRef.current) {
      mountedRef.current = true;
      void fetchBrief();
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [autoFetch, fetchBrief]);

  return { brief, isLoading, error, refresh };
}
