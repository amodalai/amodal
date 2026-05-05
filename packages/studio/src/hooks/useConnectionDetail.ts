/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { runtimeApiUrl } from '@/lib/api';
import type { EnvVarStatus } from './useConnectionPackages';

// Studio backend endpoint that reads node_modules/<pkg>/package.json
// directly. Works during setup before the runtime has booted (i.e.
// before amodal.json appears). Same response shape as the runtime's
// /api/connections/:packageName so the form code is unchanged.
const STUDIO_CONNECTION_PATH = '/api/studio/connection';

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
  const [data, setData] = useState<ConnectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!packageName) return;
    // Try Studio's backend first (reads node_modules directly, works
    // pre-runtime). Fall back to the runtime endpoint when Studio
    // returns 404 — that path is the source of truth post-setup,
    // and it can serve packages the bundle has loaded but Studio
    // can't see (e.g. cloud-mounted packages in the future).
    void (async () => {
      try {
        let res = await fetch(
          `${STUDIO_CONNECTION_PATH}/${encodeURIComponent(packageName)}`,
          { signal: AbortSignal.timeout(5_000) },
        );
        if (res.status === 404) {
          res = await fetch(
            runtimeApiUrl(`/api/connections/${encodeURIComponent(packageName)}`),
            { signal: AbortSignal.timeout(5_000) },
          );
        }
        if (!res.ok) throw new Error(`Connection lookup failed: ${String(res.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        const json = (await res.json()) as ConnectionDetail;
        setData(json);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [packageName, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const saveSecret = useCallback(
    async (name: string, value: string): Promise<void> => {
      // Lives on Studio (not the runtime) so paste-saves work before
      // the runtime has booted with an `amodal.json`. Studio writes
      // to `<repoPath>/.amodal/secrets.env`; the runtime watches
      // that file and hot-reloads `process.env` on change.
      const r = await fetch(`/api/secrets/${encodeURIComponent(name)}`, {
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
    [],
  );

  return {
    data,
    error,
    loading: !data && !error,
    refetch,
    saveSecret,
  };
}
