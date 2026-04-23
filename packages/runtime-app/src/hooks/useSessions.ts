/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/App';
import { API_PATHS } from '@/lib/api-paths';

export interface SessionSummary {
  id: string;
  appId: string;
  title?: string;
  summary: string;
  createdAt: number;
  lastAccessedAt: number;
}

interface HistoryMessage {
  role: string;
  text: string;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toSessionSummary(item: Record<string, unknown>): SessionSummary {
  return {
    id: String(item['id'] ?? ''),
    appId: String(item['app_id'] ?? ''),
    title: typeof item['title'] === 'string' ? item['title'] : undefined,
    summary: String(item['title'] ?? item['id'] ?? ''),
    createdAt: item['created_at'] ? new Date(String(item['created_at'])).getTime() : 0,
    lastAccessedAt: item['updated_at'] ? new Date(String(item['updated_at'])).getTime() : 0,
  };
}

/**
 * Fetch all sessions. Depends on auth — won't fire until token is ready (or auth is not needed).
 */
export function useSessions() {
  const { getToken, status } = useAuthContext();
  const enabled = status === 'none' || status === 'authenticated';

  return useQuery({
    queryKey: ['sessions'],
    queryFn: async (): Promise<SessionSummary[]> => {
      const token = await getToken?.() ?? null;
      const res = await fetch(API_PATHS.SESSIONS_HISTORY, { headers: authHeaders(token) });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
      return (data as Array<Record<string, unknown>>).map(toSessionSummary);
    },
    enabled,
    placeholderData: [],
  });
}

/**
 * Fetch a single session's messages.
 */
export function useSessionDetail(sessionId: string | undefined) {
  const { getToken, status } = useAuthContext();
  const enabled = (status === 'none' || status === 'authenticated') && !!sessionId;

  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: async (): Promise<HistoryMessage[]> => {
      const token = await getToken?.() ?? null;
      const res = await fetch(API_PATHS.sessionHistory(sessionId ?? ''), { headers: authHeaders(token) });
      if (!res.ok) throw new Error('Session not found');
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'messages' in data && Array.isArray((data as Record<string, unknown>)['messages'])) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        return (data as Record<string, unknown>)['messages'] as HistoryMessage[];
      }
      return [];
    },
    enabled,
    placeholderData: [],
  });
}

/**
 * Rename a session.
 */
export function useRenameSession() {
  const { getToken } = useAuthContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, title }: { sessionId: string; title: string }) => {
      const token = await getToken?.() ?? null;
      await fetch(API_PATHS.sessionHistory(sessionId), {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * Delete a session.
 */
export function useDeleteSession() {
  const { getToken } = useAuthContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const token = await getToken?.() ?? null;
      await fetch(API_PATHS.sessionHistory(sessionId), {
        method: 'DELETE',
        headers: authHeaders(token),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
