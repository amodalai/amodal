/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import { FlaskConical, Play, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalSuite {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: Date | string;
}

interface Props {
  suites: EvalSuite[];
  agentId: string;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalSuiteList({ suites, agentId, onRefresh }: Props) {
  const [runningName, setRunningName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(
    async (evalName: string) => {
      setRunningName(evalName);
      setError(null);

      try {
        const res = await fetch('/api/evals/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, evalName }),
        });

        if (!res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
          const data = (await res.json()) as { error?: { message?: string } };
          throw new Error(data.error?.message ?? `Request failed with status ${res.status}`);
        }

        onRefresh?.();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunningName(null);
      }
    },
    [agentId, onRefresh],
  );

  const getCaseCount = (config: Record<string, unknown>): number => {
    if (
      typeof config === 'object' &&
      config !== null &&
      'cases' in config &&
      Array.isArray(config.cases)
    ) {
      return config.cases.length;
    }
    return 0;
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {suites.map((suite) => (
        <div
          key={suite.id}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">{suite.name}</p>
              <p className="text-xs text-muted-foreground">
                {getCaseCount(suite.config)} test case
                {getCaseCount(suite.config) !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <button
            onClick={() => void handleRun(suite.name)}
            disabled={runningName !== null}
            className="flex items-center gap-1.5 rounded-md bg-primary-solid px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {runningName === suite.name ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run
              </>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
