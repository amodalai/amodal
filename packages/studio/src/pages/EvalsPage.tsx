/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { studioApiUrl } from '@/lib/api';
import { useEvalSuites } from '@/hooks/useEvalSuites';
import {
  EvalCard,
  type EvalSuite,
  type AvailableModel,
  type EvalHistoryEntry,
} from '@/components/views/EvalCard';

export function EvalsPage() {
  const { runtimeUrl } = useStudioConfig();
  const { suites: rawSuites, loading } = useEvalSuites();
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, EvalHistoryEntry[]>>({});

  const suites: EvalSuite[] = rawSuites.map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    query: s.query,
    assertions: s.assertions,
    assertionCount: s.assertions.length,
  }));

  // Fetch available models so EvalCard has the main model info
  useEffect(() => {
    fetch(studioApiUrl('/api/evals/arena/models'), { signal: AbortSignal.timeout(5_000) })
      .then((res) => {
        if (!res.ok) return;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        const d = data as { models: AvailableModel[] };
        setModels(d.models);
      })
      .catch(() => {
        // Models endpoint may not exist yet
      });
  }, [runtimeUrl]);

  // Fetch per-eval history
  useEffect(() => {
    for (const suite of suites) {
      fetch(studioApiUrl(`/api/evals/runs/by-eval/${encodeURIComponent(suite.name)}`), { signal: AbortSignal.timeout(5_000) })
        .then((res) => {
          if (!res.ok) return;
          return res.json();
        })
        .then((data: unknown) => {
          if (!data) return;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
          const d = data as { entries: EvalHistoryEntry[] };
          setHistoryMap((prev) => ({ ...prev, [suite.name]: d.entries }));
        })
        .catch(() => {
          // History endpoint may not exist
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- suites derived from rawSuites, using rawSuites as dep
  }, [rawSuites, runtimeUrl]);

  if (loading) return null;

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
            No eval suites found. Create <code className="px-1 py-0.5 rounded bg-muted">.md</code> files in the <code className="px-1 py-0.5 rounded bg-muted">evals/</code> directory.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {suites.map((suite) => (
            <EvalCard
              key={suite.name}
              suite={suite}
              models={models}
              history={historyMap[suite.name] ?? []}
              hideModelSelector={true}
              runtimeUrl={runtimeUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
