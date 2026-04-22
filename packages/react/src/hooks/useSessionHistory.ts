/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listSessions, updateSession } from '../client/chat-api';
import type { SessionHistoryItem } from '../client/chat-api';

export interface UseSessionHistoryOptions {
  serverUrl: string;
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  enabled: boolean;
}

export interface UseSessionHistoryReturn {
  sessions: SessionHistoryItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  updateTags: (sessionId: string, tags: string[]) => void;
  updateTitle: (sessionId: string, title: string) => void;
  allTags: string[];
}

export function useSessionHistory(options: UseSessionHistoryOptions): UseSessionHistoryReturn {
  const { serverUrl, getToken, enabled } = options;
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const refresh = useCallback(() => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);

    const doFetch = async () => {
      try {
        const rawToken = getTokenRef.current?.();
        const token = (rawToken instanceof Promise ? await rawToken : rawToken) ?? undefined;
        const result = await listSessions(serverUrl, token);
        setSessions(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
      }
    };
    void doFetch();
  }, [serverUrl, enabled]);

  const updateTags = useCallback(
    (sessionId: string, tags: string[]) => {
      const doUpdate = async () => {
        try {
          const rawToken = getTokenRef.current?.();
        const token = (rawToken instanceof Promise ? await rawToken : rawToken) ?? undefined;
          await updateSession(serverUrl, sessionId, { tags }, token);
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, tags } : s)),
          );
        } catch {
          // Non-critical
        }
      };
      void doUpdate();
    },
    [serverUrl],
  );

  const updateTitle = useCallback(
    (sessionId: string, title: string) => {
      const doUpdate = async () => {
        try {
          const rawToken = getTokenRef.current?.();
        const token = (rawToken instanceof Promise ? await rawToken : rawToken) ?? undefined;
          await updateSession(serverUrl, sessionId, { title }, token);
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
          );
        } catch {
          // Non-critical
        }
      };
      void doUpdate();
    },
    [serverUrl],
  );

  // Collect all unique tags across sessions
  const allTags = [...new Set(sessions.flatMap((s) => s.tags))].sort();

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, refresh]);

  return { sessions, isLoading, error, refresh, updateTags, updateTitle, allTags };
}
