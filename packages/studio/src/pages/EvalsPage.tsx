/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { EvalSuiteList } from '@/components/views/EvalSuiteList';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalSuite {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: Date | string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EvalsPage() {
  const { agentId } = useStudioConfig();
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchSuites = useCallback(() => {
    fetch(`/api/studio/evals?agentId=${encodeURIComponent(agentId)}`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ suites: EvalSuite[] }>;
      })
      .then((d) => setSuites(d.suites))
      .catch(() => {
        // Leave empty
      })
      .finally(() => setLoaded(true));
  }, [agentId]);

  useEffect(() => {
    fetchSuites();
  }, [fetchSuites]);

  if (!loaded) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Evals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run test suites against your agent and track pass rates over time.
        </p>
      </div>

      {suites.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No eval suites found. Create a suite to start testing your agent.
          </p>
        </div>
      ) : (
        <EvalSuiteList suites={suites} agentId={agentId} onRefresh={fetchSuites} />
      )}
    </div>
  );
}
