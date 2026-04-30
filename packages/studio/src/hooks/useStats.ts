/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { runtimeApiUrl } from '@/lib/api';

export interface ModelStats {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentStats {
  sessions: number;
  tokens: { input: number; output: number; total: number };
  lastActive: string | null;
  topModels: ModelStats[];
}

export interface StatsResult {
  data: AgentStats | null;
  error: string | null;
  loading: boolean;
}

export function useStats(): StatsResult {
  const [data, setData] = useState<AgentStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(runtimeApiUrl('/api/stats'), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<AgentStats>;
      })
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return { data, error, loading: !data && !error };
}
