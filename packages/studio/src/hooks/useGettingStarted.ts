/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';

export interface EnvVarStatus {
  name: string;
  description: string;
  set: boolean;
}

export interface GettingStartedPackage {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  envVars: EnvVarStatus[];
  isFulfilled: boolean;
}

export interface TemplateConnectionSlot {
  label: string;
  description?: string;
  options: string[];
  required?: boolean;
  multi?: boolean;
}

export interface TemplateManifest {
  name?: string;
  description?: string;
  connections?: TemplateConnectionSlot[];
  identity?: { role?: string; tone?: string; persona?: string };
  knowledge?: Array<{ id: string; label: string; description?: string }>;
}

export interface GettingStartedData {
  template: TemplateManifest | null;
  packages: GettingStartedPackage[];
}

export interface GettingStartedResult {
  data: GettingStartedData | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Calls the runtime's `/api/getting-started` endpoint, which scans the
 * agent's loaded connection packages, projects each one's amodal block
 * (displayName/description/icon/envVars/fulfilled?), and bundles the
 * optional template.json from the agent repo.
 */
export function useGettingStarted(): GettingStartedResult {
  const { runtimeUrl } = useStudioConfig();
  const [data, setData] = useState<GettingStartedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${runtimeUrl}/api/getting-started`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<GettingStartedData>;
      })
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [runtimeUrl, tick]);

  return {
    data,
    error,
    loading: !data && !error,
    refetch: () => setTick((t) => t + 1),
  };
}
