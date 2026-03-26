/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SSEEvent, TaskStatusValue } from '../types';
import { useAmodalContext } from '../provider';

export interface UseAmodalTaskOptions {
  /** The task ID to stream. */
  taskId: string;
  /** If true, starts streaming automatically on mount. Defaults to true. */
  autoStream?: boolean;
}

export interface UseAmodalTaskReturn {
  status: TaskStatusValue | 'idle';
  progress: string;
  result: string;
  events: SSEEvent[];
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Streams GET /task/:id/stream events.
 */
export function useAmodalTask(options: UseAmodalTaskOptions): UseAmodalTaskReturn {
  const { taskId, autoStream = true } = options;
  const { client } = useAmodalContext();
  const [status, setStatus] = useState<TaskStatusValue | 'idle'>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState('');
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const start = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('running');
    setError(null);
    setEvents([]);
    setResult('');
    setProgress('');

    try {
      let text = '';

      for await (const event of client.streamTask(taskId, controller.signal)) {
        setEvents((prev) => [...prev, event]);

        switch (event.type) {
          case 'text_delta':
            text += event.content;
            setResult(text);
            break;
          case 'tool_call_start':
            setProgress(`Running ${event.tool_name}...`);
            break;
          case 'tool_call_result':
            setProgress('');
            break;
          case 'error':
            setError(event.message);
            setStatus('error');
            return;
          case 'done':
            setStatus('completed');
            return;
          default:
            break;
        }
      }

      // Stream ended without done event
      if (status === 'running') {
        setStatus('completed');
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [client, taskId, status]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (autoStream && !startedRef.current) {
      startedRef.current = true;
      void startRef.current();
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [autoStream]);

  return {
    status,
    progress,
    result,
    events,
    error,
    start: () => void start(),
    stop,
  };
}
