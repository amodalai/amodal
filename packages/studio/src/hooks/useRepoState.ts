/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';

interface RepoStateResponse {
  hasAmodalJson: boolean;
  repoPath: string | null;
}

export interface UseRepoStateResult {
  /** True when `<repoPath>/amodal.json` exists. Drives index routing. */
  hasAmodalJson: boolean;
  loading: boolean;
  /** Set when the probe fails. We treat errors as "configured" to avoid
   *  trapping users in the create flow when the runtime is just slow. */
  error: string | null;
}

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Polls Studio's `/api/repo-state` once on mount. Lives on the Studio
 * server (not the runtime) because the runtime can't even start when
 * `amodal.json` is missing.
 */
export function useRepoState(): UseRepoStateResult {
  const [state, setState] = useState<UseRepoStateResult>({
    hasAmodalJson: true,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/repo-state', {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`Repo-state probe returned ${String(res.status)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        const data = (await res.json()) as RepoStateResponse;
        if (!cancelled) {
          setState({
            hasAmodalJson: data.hasAmodalJson,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            // Default to "configured" on error — better to show the workspace
            // home and let downstream pages handle offline state than to
            // strand a configured user in the create flow.
            hasAmodalJson: true,
            loading: false,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error normalization at module boundary
            error: (err as Error).message ?? 'Failed to probe repo state',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
