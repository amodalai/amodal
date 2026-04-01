/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedEval} from '../repo/repo-types.js';

/**
 * Result of judging a single assertion.
 */
export interface AssertionResult {
  text: string;
  negated: boolean;
  passed: boolean;
  reason: string;
}

/**
 * Token and cost tracking for a single eval case or aggregated run.
 */
export interface EvalCostInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Tokens served from prompt cache (90% cheaper than base input). */
  cacheReadInputTokens?: number;
  /** Tokens written to prompt cache (25% more expensive than base input). */
  cacheCreationInputTokens?: number;
  /** Actual estimated cost accounting for cache pricing. */
  estimatedCostMicros: number;
  /** Hypothetical cost if caching were disabled (all input at base price). */
  estimatedCostNoCacheMicros?: number;
}

/**
 * Model identity for an eval run.
 */
export interface EvalModelInfo {
  provider: string;
  model: string;
}

/**
 * Result of running a single eval case.
 */
export interface EvalResult {
  eval: LoadedEval;
  response: string;
  toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
  assertions: AssertionResult[];
  passed: boolean;
  durationMs: number;
  cost?: EvalCostInfo;
  error?: string;
}

/**
 * Result of running an entire eval suite.
 */
export interface EvalSuiteResult {
  results: EvalResult[];
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  totalDurationMs: number;
  totalCost?: EvalCostInfo;
  model?: EvalModelInfo;
  gitSha?: string;
  timestamp: string;
}

/**
 * A stored baseline for comparison.
 */
export interface EvalBaseline {
  id: string;
  orgId: string;
  gitSha: string;
  isProduction: boolean;
  result: EvalSuiteResult;
  createdAt: string;
}

/**
 * Status of a single eval comparison.
 */
export type EvalDiffStatus = 'unchanged' | 'improved' | 'regressed' | 'new' | 'removed';

/**
 * Diff between current and baseline eval results.
 */
export interface EvalDiff {
  evalName: string;
  status: EvalDiffStatus;
  currentPassed: boolean | null;
  baselinePassed: boolean | null;
  assertionChanges: Array<{
    text: string;
    currentPassed: boolean | null;
    baselinePassed: boolean | null;
    status: EvalDiffStatus;
  }>;
}

/**
 * Progress event emitted during eval execution.
 */
export interface EvalProgress {
  type: 'eval_start' | 'eval_complete' | 'suite_complete';
  evalName?: string;
  passed?: boolean;
  current?: number;
  total?: number;
}

/**
 * A complete eval run with model and cost tracking.
 */
export interface EvalRunRecord {
  id: string;
  orgId: string;
  appId?: string;
  model: EvalModelInfo;
  suite: EvalSuiteResult;
  perCaseCosts: EvalCostInfo[];
  totalCost: EvalCostInfo;
  gitSha?: string;
  label?: string;
  triggeredBy: 'manual' | 'ci' | 'automation';
  createdAt: string;
}

/**
 * Comparison of two eval runs.
 */
export interface EvalRunComparison {
  runA: EvalRunRecord;
  runB: EvalRunRecord;
  diff: EvalDiff[];
  costDelta: {
    totalMicros: number;
    perCase: number[];
  };
  qualityDelta: {
    passRateDelta: number;
    durationDeltaMs: number;
  };
}

/**
 * Aggregated trend point for time-series visualization.
 */
export interface EvalTrendPoint {
  runId: string;
  label?: string;
  gitSha?: string;
  model: EvalModelInfo;
  passRate: number;
  totalCostMicros: number;
  avgDurationMs: number;
  timestamp: string;
}
