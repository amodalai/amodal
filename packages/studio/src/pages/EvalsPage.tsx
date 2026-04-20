/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useStudioConfig } from '../contexts/StudioConfigContext';
import { useEvalSuites } from '@/hooks/useEvalSuites';
import { EvalSuiteList } from '@/components/views/EvalSuiteList';

export function EvalsPage() {
  const { agentId } = useStudioConfig();
  const { suites, loading, refresh } = useEvalSuites();

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
        <EvalSuiteList
          suites={suites.map((s) => ({
            id: s.id,
            name: s.name,
            config: {
              title: s.title,
              description: s.description,
              query: s.query,
              assertions: s.assertions,
              cases: s.query ? [{ input: s.query, expected: undefined }] : [],
            },
            createdAt: new Date().toISOString(),
          }))}
          agentId={agentId}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
