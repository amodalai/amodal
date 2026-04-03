/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState, useCallback } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { SuitesTab } from './ModelArenaPage';

interface EvalSuite {
  name: string;
  title: string;
  description: string;
  query: string;
  assertionCount: number;
  assertions: Array<{ text: string; negated: boolean }>;
}

export function EvalSuitePage() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [runAllTrigger, setRunAllTrigger] = useState(0);
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  const loadSuites = useCallback(() => {
    fetch('/api/evals/suites')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { suites: EvalSuite[] };
        setSuites(d.suites);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSuites();
  }, [loadSuites]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">Eval Suite</h1>
          </div>
          {suites.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-[11px]">
                <button onClick={() => setExpandAll(true)} className="text-primary hover:text-primary/70 transition-colors">expand all</button>
                <span className="text-gray-300 dark:text-zinc-700">/</span>
                <button onClick={() => setExpandAll(false)} className="text-primary hover:text-primary/70 transition-colors">collapse all</button>
              </div>
              <button
                onClick={() => setRunAllTrigger((prev) => prev + 1)}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary transition-colors flex items-center gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                Run All
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-2xl">
          Run your eval cases against the configured model. Each eval sends a query to the agent and checks assertions with an LLM judge. Green means pass, red means fail. Add evals in the <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-[11px]">evals/</code> directory.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <SuitesTab suites={suites} hideModelSelector runAllTrigger={runAllTrigger} expandAll={expandAll} />
        </div>
      </div>
    </div>
  );
}
