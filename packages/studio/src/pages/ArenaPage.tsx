/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { studioApiUrl } from '@/lib/api';
import { useEvalSuites } from '@/hooks/useEvalSuites';
import {
  EvalCard,
  type EvalSuite,
  type AvailableModel,
  type EvalHistoryEntry,
} from '@/components/views/EvalCard';

/* ------------------------------------------------------------------ */
/*  SuitesTab                                                           */
/* ------------------------------------------------------------------ */

function SuitesTab({ suites, hideModelSelector, runAllTrigger, expandAll }: { suites: EvalSuite[]; hideModelSelector?: boolean; runAllTrigger?: number; expandAll?: boolean | null }) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, EvalHistoryEntry[]>>({});

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
        // Arena models endpoint may not exist yet
      });
  }, []);

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
  }, [suites]);

  if (suites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FlaskConical className="h-12 w-12 text-primary/20 mb-4" />
        <h3 className="text-sm font-semibold text-muted-foreground mb-2">No evals defined</h3>
        <p className="text-xs text-muted-foreground max-w-sm">
          Create eval files in the <code className="px-1 py-0.5 rounded bg-muted">evals/</code> directory. Each eval is a markdown file with a query and assertions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suites.map((suite) => (
        <EvalCard
          key={suite.name}
          suite={suite}
          models={models}
          history={historyMap[suite.name] ?? []}
          hideModelSelector={hideModelSelector}
          autoRunTrigger={runAllTrigger}
          expandOverride={expandAll}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function ArenaPage() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  const evalSuitesHook = useEvalSuites();

  useEffect(() => {
    setSuites(evalSuitesHook.suites.map((s) => ({
      name: s.name,
      title: s.title,
      description: s.description,
      query: s.query,
      assertions: s.assertions,
      assertionCount: s.assertions.length,
    })));
  }, [evalSuitesHook.suites]);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Model Arena</h1>
          </div>
          {suites.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <button onClick={() => setExpandAll(true)} className="text-primary hover:text-primary/70 transition-colors">expand all</button>
              <span className="text-muted-foreground">/</span>
              <button onClick={() => setExpandAll(false)} className="text-primary hover:text-primary/70 transition-colors">collapse all</button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl mb-0">
          Compare how different models perform on your eval suite. Select models, run them side by side, and compare quality, speed, and cost. Use this to find the best model for your use case or to validate a model swap before deploying.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <SuitesTab suites={suites} expandAll={expandAll} />
        </div>
      </div>
    </div>
  );
}
