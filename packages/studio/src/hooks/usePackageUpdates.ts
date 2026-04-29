/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageUpdate {
  name: string;
  installed: string | null;
  latest: string | null;
  hasUpdate: boolean;
}

interface PackageUpdatesResponse {
  updates: PackageUpdate[];
  checkedAt: number;
}

export interface UsePackageUpdatesResult {
  updates: PackageUpdate[];
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Polls the runtime's `/api/package-updates` endpoint on mount. The runtime
 * caches results for 1 day, so calling this on every home-screen render is
 * cheap. Returns the full updates list — callers filter by `hasUpdate` for
 * the notification UI.
 */
export function usePackageUpdates(): UsePackageUpdatesResult {
  const { runtimeUrl } = useStudioConfig();
  const [state, setState] = useState<UsePackageUpdatesResult>({
    updates: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${runtimeUrl}/api/package-updates`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`Runtime returned ${String(res.status)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing runtime response
        const data = (await res.json()) as PackageUpdatesResponse;
        if (!cancelled) {
          setState({ updates: data.updates, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            updates: [],
            loading: false,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error normalization at module boundary
            error: (err as Error).message ?? 'Failed to check for updates',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtimeUrl]);

  return state;
}
