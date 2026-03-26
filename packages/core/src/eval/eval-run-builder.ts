/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  EvalCostInfo,
  EvalModelInfo,
  EvalRunRecord,
  EvalRunComparison,
  EvalSuiteResult,
  EvalTrendPoint,
} from './eval-types.js';
import {diffEvalResults} from './eval-diff.js';
import {aggregateRunCost} from './eval-cost.js';

/**
 * Build an EvalRunRecord from a suite result and model info.
 */
export function buildEvalRun(
  suite: EvalSuiteResult,
  model: EvalModelInfo,
  options: {
    id?: string;
    orgId: string;
    appId?: string;
    gitSha?: string;
    label?: string;
    triggeredBy?: 'manual' | 'ci' | 'automation';
  },
): EvalRunRecord {
  const perCaseCosts: EvalCostInfo[] = suite.results.map(
    (r) => r.cost ?? {inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostMicros: 0},
  );

  const totalCost = suite.totalCost ?? aggregateRunCost(perCaseCosts);

  return {
    id: options.id ?? crypto.randomUUID(),
    orgId: options.orgId,
    appId: options.appId,
    model,
    suite,
    perCaseCosts,
    totalCost,
    gitSha: options.gitSha ?? suite.gitSha,
    label: options.label,
    triggeredBy: options.triggeredBy ?? 'manual',
    createdAt: suite.timestamp,
  };
}

/**
 * Compare two eval runs, producing diffs and cost/quality deltas.
 */
export function compareRuns(runA: EvalRunRecord, runB: EvalRunRecord): EvalRunComparison {
  const diff = diffEvalResults(runA.suite, runB.suite);

  const totalA = runA.suite.results.length;
  const totalB = runB.suite.results.length;
  const passRateA = totalA > 0 ? runA.suite.totalPassed / totalA : 0;
  const passRateB = totalB > 0 ? runB.suite.totalPassed / totalB : 0;

  const maxLen = Math.max(runA.perCaseCosts.length, runB.perCaseCosts.length);
  const perCaseDeltas: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const costA = runA.perCaseCosts[i]?.estimatedCostMicros ?? 0;
    const costB = runB.perCaseCosts[i]?.estimatedCostMicros ?? 0;
    perCaseDeltas.push(costB - costA);
  }

  return {
    runA,
    runB,
    diff,
    costDelta: {
      totalMicros: runB.totalCost.estimatedCostMicros - runA.totalCost.estimatedCostMicros,
      perCase: perCaseDeltas,
    },
    qualityDelta: {
      passRateDelta: passRateB - passRateA,
      durationDeltaMs: runB.suite.totalDurationMs - runA.suite.totalDurationMs,
    },
  };
}

/**
 * Extract trend points from a list of eval runs for charting.
 */
export function buildTrendPoints(runs: EvalRunRecord[]): EvalTrendPoint[] {
  return runs.map((run) => {
    const total = run.suite.results.length;
    const passRate = total > 0 ? run.suite.totalPassed / total : 0;
    const avgDurationMs = total > 0 ? run.suite.totalDurationMs / total : 0;

    return {
      runId: run.id,
      label: run.label,
      gitSha: run.gitSha,
      model: run.model,
      passRate,
      totalCostMicros: run.totalCost.estimatedCostMicros,
      avgDurationMs,
      timestamp: run.createdAt,
    };
  });
}
