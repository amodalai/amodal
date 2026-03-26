/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {buildEvalRun, compareRuns, buildTrendPoints} from './eval-run-builder.js';
import type {EvalSuiteResult, EvalModelInfo, EvalRunRecord} from './eval-types.js';

function makeSuiteResult(overrides: Partial<EvalSuiteResult> = {}): EvalSuiteResult {
  return {
    results: [
      {
        eval: {name: 'test-1', title: 'Test 1', description: '', setup: {}, query: 'q', assertions: [], raw: '', location: '/test'},
        response: 'ok',
        toolCalls: [],
        assertions: [{text: 'be correct', negated: false, passed: true, reason: 'yes'}],
        passed: true,
        durationMs: 1000,
        cost: {inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostMicros: 1050},
      },
      {
        eval: {name: 'test-2', title: 'Test 2', description: '', setup: {}, query: 'q', assertions: [], raw: '', location: '/test'},
        response: 'nope',
        toolCalls: [],
        assertions: [{text: 'be correct', negated: false, passed: false, reason: 'no'}],
        passed: false,
        durationMs: 2000,
        cost: {inputTokens: 200, outputTokens: 100, totalTokens: 300, estimatedCostMicros: 2100},
      },
    ],
    totalPassed: 1,
    totalFailed: 1,
    totalSkipped: 0,
    totalDurationMs: 3000,
    totalCost: {inputTokens: 300, outputTokens: 150, totalTokens: 450, estimatedCostMicros: 3150},
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const testModel: EvalModelInfo = {provider: 'anthropic', model: 'claude-sonnet-4-20250514'};

describe('buildEvalRun', () => {
  it('builds a run record from suite result', () => {
    const suite = makeSuiteResult();
    const run = buildEvalRun(suite, testModel, {orgId: 'org-1'});

    expect(run.orgId).toBe('org-1');
    expect(run.model).toEqual(testModel);
    expect(run.suite).toBe(suite);
    expect(run.perCaseCosts).toHaveLength(2);
    expect(run.totalCost.estimatedCostMicros).toBe(3150);
    expect(run.triggeredBy).toBe('manual');
    expect(run.id).toBeTruthy();
  });

  it('uses provided options', () => {
    const suite = makeSuiteResult({gitSha: 'sha-from-suite'});
    const run = buildEvalRun(suite, testModel, {
      id: 'run-123',
      orgId: 'org-1',
      appId: 'app-1',
      gitSha: 'sha-override',
      label: 'pr-456',
      triggeredBy: 'ci',
    });

    expect(run.id).toBe('run-123');
    expect(run.appId).toBe('app-1');
    expect(run.gitSha).toBe('sha-override');
    expect(run.label).toBe('pr-456');
    expect(run.triggeredBy).toBe('ci');
  });

  it('falls back to suite gitSha if not provided', () => {
    const suite = makeSuiteResult({gitSha: 'suite-sha'});
    const run = buildEvalRun(suite, testModel, {orgId: 'org-1'});
    expect(run.gitSha).toBe('suite-sha');
  });

  it('handles results without cost info', () => {
    const suite = makeSuiteResult();
    // Remove cost from results
    for (const r of suite.results) {
      delete r.cost;
    }
    delete suite.totalCost;

    const run = buildEvalRun(suite, testModel, {orgId: 'org-1'});
    expect(run.perCaseCosts).toHaveLength(2);
    expect(run.perCaseCosts[0].estimatedCostMicros).toBe(0);
    expect(run.totalCost.estimatedCostMicros).toBe(0);
  });
});

describe('compareRuns', () => {
  it('computes quality and cost deltas', () => {
    const suiteA = makeSuiteResult();
    const suiteB = makeSuiteResult({
      totalPassed: 2,
      totalFailed: 0,
      totalDurationMs: 2000,
      totalCost: {inputTokens: 200, outputTokens: 100, totalTokens: 300, estimatedCostMicros: 2000},
    });
    // Make all results pass in B
    for (const r of suiteB.results) {
      r.passed = true;
      for (const a of r.assertions) {
        a.passed = true;
      }
    }

    const runA = buildEvalRun(suiteA, testModel, {id: 'a', orgId: 'org-1'});
    const runB = buildEvalRun(suiteB, {provider: 'openai', model: 'gpt-4o'}, {id: 'b', orgId: 'org-1'});

    const comparison = compareRuns(runA, runB);

    expect(comparison.runA.id).toBe('a');
    expect(comparison.runB.id).toBe('b');
    expect(comparison.diff).toBeDefined();
    // B has higher pass rate (1.0 vs 0.5)
    expect(comparison.qualityDelta.passRateDelta).toBe(0.5);
    // B is faster (2000 vs 3000)
    expect(comparison.qualityDelta.durationDeltaMs).toBe(-1000);
    // B is cheaper (2000 vs 3150)
    expect(comparison.costDelta.totalMicros).toBe(-1150);
  });

  it('handles runs with different numbers of cases', () => {
    const suiteA = makeSuiteResult();
    const suiteBResults = makeSuiteResult().results.slice(0, 1);
    const suiteB: EvalSuiteResult = {
      results: suiteBResults,
      totalPassed: 1,
      totalFailed: 0,
      totalSkipped: 0,
      totalDurationMs: 1000,
      totalCost: {inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostMicros: 1050},
      timestamp: '2025-01-02T00:00:00.000Z',
    };

    const runA = buildEvalRun(suiteA, testModel, {id: 'a', orgId: 'org-1'});
    const runB = buildEvalRun(suiteB, testModel, {id: 'b', orgId: 'org-1'});

    const comparison = compareRuns(runA, runB);
    // perCase deltas should cover the max length
    expect(comparison.costDelta.perCase).toHaveLength(2);
  });
});

describe('buildTrendPoints', () => {
  it('extracts trend points from runs', () => {
    const runs: EvalRunRecord[] = [
      buildEvalRun(makeSuiteResult(), testModel, {id: 'r1', orgId: 'org-1', label: 'v1'}),
      buildEvalRun(
        makeSuiteResult({totalPassed: 2, totalFailed: 0}),
        {provider: 'openai', model: 'gpt-4o'},
        {id: 'r2', orgId: 'org-1', label: 'v2'},
      ),
    ];

    const points = buildTrendPoints(runs);
    expect(points).toHaveLength(2);

    expect(points[0].runId).toBe('r1');
    expect(points[0].passRate).toBe(0.5);
    expect(points[0].totalCostMicros).toBe(3150);
    expect(points[0].model.provider).toBe('anthropic');

    expect(points[1].runId).toBe('r2');
    expect(points[1].passRate).toBe(1);
    expect(points[1].model.provider).toBe('openai');
  });

  it('handles empty runs list', () => {
    const points = buildTrendPoints([]);
    expect(points).toHaveLength(0);
  });

  it('handles run with no results', () => {
    const emptySuite: EvalSuiteResult = {
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      totalSkipped: 0,
      totalDurationMs: 0,
      timestamp: '2025-01-01T00:00:00.000Z',
    };
    const run = buildEvalRun(emptySuite, testModel, {id: 'r1', orgId: 'org-1'});
    const points = buildTrendPoints([run]);

    expect(points[0].passRate).toBe(0);
    expect(points[0].avgDurationMs).toBe(0);
  });
});
