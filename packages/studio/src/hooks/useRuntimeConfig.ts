/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';

// ---------------------------------------------------------------------------
// Types — matches the runtime's GET /api/config response
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  appId?: string;
  appName?: string;
  name: string;
  version?: string;
  description?: string;
  models?: Record<string, { provider: string; model: string }>;
  stores?: Record<string, unknown> | null;
  repoPath?: string;
  envRefs?: Array<{ name: string; connection?: string; set: boolean }>;
  providerStatuses?: Array<{
    provider: string;
    envVar: string;
    keySet: boolean;
    verified: boolean;
  }>;
  runtimeVersion?: string;
  nodeVersion?: string;
  uptime?: number;
}

export interface RuntimeConfigResult {
  config: RuntimeConfig | null;
  error: string | null;
  loading: boolean;
}

export function useRuntimeConfig(): RuntimeConfigResult {
  const { runtimeUrl } = useStudioConfig();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${runtimeUrl}/api/config`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<RuntimeConfig>;
      })
      .then(setConfig)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
  }, [runtimeUrl]);

  return { config, error, loading: !config && !error };
}
