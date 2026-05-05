/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect, useState} from 'react';
import {runtimeApiUrl} from '@/lib/api';

export interface SessionHistoryRow {
  id: string;
  app_id: string;
  scope_id: string;
  title: string;
  message_count: number;
  token_usage: {input_tokens: number; output_tokens: number; total_tokens: number};
  model: string | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionHistoryResult {
  sessions: SessionHistoryRow[] | null;
  error: string | null;
  loading: boolean;
}

export function useSessionHistory(): SessionHistoryResult {
  const [sessions, setSessions] = useState<SessionHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(runtimeApiUrl('/sessions/history'), {signal: AbortSignal.timeout(5_000)})
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionHistoryRow[]>;
      })
      .then(setSessions)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return {sessions, error, loading: !sessions && !error};
}
