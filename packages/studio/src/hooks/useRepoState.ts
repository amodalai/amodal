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

export interface UseRepoStateOptions {
  /**
   * Poll the probe on a 2-second loop instead of once on mount.
   * Phase E.7 uses this on `CreateFlowPage`'s chat mode so the page
   * notices when commit_setup writes amodal.json (regardless of who
   * triggered it — agent or "Finish setup" button) and transitions
   * the user from chat to OverviewPage in-place.
   *
   * Polling stops automatically once `hasAmodalJson` flips to true —
   * once the file lands the answer doesn't change.
   */
  polling?: boolean;
}

const PROBE_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Polls Studio's `/api/repo-state`. By default fires once on mount;
 * passing `{polling: true}` re-probes every 2 seconds until
 * `hasAmodalJson` flips to true. Lives on the Studio server (not
 * the runtime) because the runtime can't even start when
 * `amodal.json` is missing.
 */
export function useRepoState(options?: UseRepoStateOptions): UseRepoStateResult {
  const polling = options?.polling === true;
  const [state, setState] = useState<UseRepoStateResult>({
    hasAmodalJson: true,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function probe(): Promise<void> {
      try {
        const res = await fetch('/api/repo-state', {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`Repo-state probe returned ${String(res.status)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        const data = (await res.json()) as RepoStateResponse;
        if (cancelled) return;
        setState({
          hasAmodalJson: data.hasAmodalJson,
          loading: false,
          error: null,
        });
        // Re-arm the loop unless the file landed (in which case the
        // answer is stable forever) or we've been cancelled.
        if (polling && !data.hasAmodalJson) {
          timer = setTimeout(() => {
            if (!cancelled) void probe();
          }, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          // Default to "configured" on error — better to show the workspace
          // home and let downstream pages handle offline state than to
          // strand a configured user in the create flow.
          hasAmodalJson: true,
          loading: false,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error normalization at module boundary
          error: (err as Error).message ?? 'Failed to probe repo state',
        });
        // Don't keep polling forever on transient errors — bail to
        // the "configured" default and let the user retry by reloading.
      }
    }

    void probe();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [polling]);

  return state;
}
