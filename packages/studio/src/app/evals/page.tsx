/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { listEvalSuites } from '@/lib/eval-queries';
import { getBackend } from '@/lib/startup';
import { EvalSuiteList } from './EvalSuiteList';

export const dynamic = 'force-dynamic';

export default async function EvalsPage() {
  const backend = await getBackend();
  const workspace = await backend.getWorkspace();
  const agentId = workspace.agentId;

  const suites = await listEvalSuites(agentId);

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
        <EvalSuiteList suites={suites} agentId={agentId} />
      )}
    </div>
  );
}
