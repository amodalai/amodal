/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import type { EnvVarStatus } from './useGettingStarted';

export interface ConnectionOauthDetail {
  appKey: string;
  available: boolean;
  scopes?: string[];
  reason?: 'no_credentials';
}

export interface ConnectionDetail {
  name: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  /** From spec.json auth.type — drives which UI branch the page renders. */
  authType: 'bearer' | 'api-key' | 'basic' | 'oauth' | 'none' | string;
  envVars: EnvVarStatus[];
  oauth: ConnectionOauthDetail | null;
}

export interface ConnectionDetailResult {
  data: ConnectionDetail | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
  saveSecret: (name: string, value: string) => Promise<void>;
}

/**
 * Fetches `/api/connections/:packageName` from the runtime and exposes
 * a `saveSecret` writer that POSTs to `/api/secrets/:name`. Used by the
 * per-connection configure page.
 */
export function useConnectionDetail(packageName: string): ConnectionDetailResult {
  const { runtimeUrl } = useStudioConfig();
  const [data, setData] = useState<ConnectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!packageName) return;
    fetch(`${runtimeUrl}/api/connections/${encodeURIComponent(packageName)}`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<ConnectionDetail>;
      })
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [runtimeUrl, packageName, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const saveSecret = useCallback(
    async (name: string, value: string): Promise<void> => {
      const r = await fetch(`${runtimeUrl}/api/secrets/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Save failed: ${String(r.status)}${text ? ` — ${text}` : ''}`);
      }
      setTick((t) => t + 1);
    },
    [runtimeUrl],
  );

  return {
    data,
    error,
    loading: !data && !error,
    refetch,
    saveSecret,
  };
}
