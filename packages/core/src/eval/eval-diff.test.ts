/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {diffEvalResults} from './eval-diff.js';
import type {EvalSuiteResult, EvalResult} from './eval-types.js';

function makeResult(name: string, passed: boolean, assertions: Array<{text: string; passed: boolean}> = []): EvalResult {
  return {
    eval: {name, title: name, description: '', setup: {}, query: '', assertions: [], raw: '', location: ''},
    response: '',
    toolCalls: [],
    assertions: assertions.length > 0
      ? assertions.map((a) => ({...a, negated: false, reason: ''}))
      : [{text: 'default', negated: false, passed, reason: ''}],
    passed,
    durationMs: 100,
  };
}

function makeSuite(results: EvalResult[]): EvalSuiteResult {
  return {
    results,
    totalPassed: results.filter((r) => r.passed).length,
    totalFailed: results.filter((r) => !r.passed).length,
    totalSkipped: 0,
    totalDurationMs: 500,
    timestamp: new Date().toISOString(),
  };
}

describe('diffEvalResults', () => {
  it('marks unchanged when both pass', () => {
    const current = makeSuite([makeResult('eval-1', true)]);
    const baseline = makeSuite([makeResult('eval-1', true)]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('unchanged');
  });

  it('marks regressed when baseline passed but current fails', () => {
    const current = makeSuite([makeResult('eval-1', false)]);
    const baseline = makeSuite([makeResult('eval-1', true)]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs[0].status).toBe('regressed');
    expect(diffs[0].currentPassed).toBe(false);
    expect(diffs[0].baselinePassed).toBe(true);
  });

  it('marks improved when baseline failed but current passes', () => {
    const current = makeSuite([makeResult('eval-1', true)]);
    const baseline = makeSuite([makeResult('eval-1', false)]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs[0].status).toBe('improved');
  });

  it('marks new evals that are not in baseline', () => {
    const current = makeSuite([makeResult('new-eval', true)]);
    const baseline = makeSuite([]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs[0].status).toBe('new');
    expect(diffs[0].baselinePassed).toBeNull();
  });

  it('marks removed evals that are not in current', () => {
    const current = makeSuite([]);
    const baseline = makeSuite([makeResult('old-eval', true)]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs[0].status).toBe('removed');
    expect(diffs[0].currentPassed).toBeNull();
  });

  it('detects assertion-level regression', () => {
    const current = makeSuite([makeResult('eval-1', false, [
      {text: 'assert-a', passed: true},
      {text: 'assert-b', passed: false},
    ])]);
    const baseline = makeSuite([makeResult('eval-1', true, [
      {text: 'assert-a', passed: true},
      {text: 'assert-b', passed: true},
    ])]);

    const diffs = diffEvalResults(current, baseline);
    expect(diffs[0].status).toBe('regressed');
    expect(diffs[0].assertionChanges[0].status).toBe('unchanged');
    expect(diffs[0].assertionChanges[1].status).toBe('regressed');
  });
});
