/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {formatEvalTable, formatDiffTable, formatEvalMarkdown} from './eval-formatter.js';
import type {EvalSuiteResult, EvalDiff} from './eval-types.js';

function makeSuiteResult(): EvalSuiteResult {
  return {
    results: [
      {
        eval: {name: 'test-alpha', title: 'Alpha', description: '', setup: {}, query: '', assertions: [], raw: '', location: ''},
        response: 'ok',
        toolCalls: [],
        assertions: [
          {text: 'be correct', negated: false, passed: true, reason: 'yes'},
          {text: 'include details', negated: false, passed: false, reason: 'no'},
        ],
        passed: false,
        durationMs: 150,
      },
      {
        eval: {name: 'test-beta', title: 'Beta', description: '', setup: {}, query: '', assertions: [], raw: '', location: ''},
        response: 'good',
        toolCalls: [],
        assertions: [{text: 'be good', negated: false, passed: true, reason: 'yes'}],
        passed: true,
        durationMs: 80,
      },
    ],
    totalPassed: 1,
    totalFailed: 1,
    totalSkipped: 0,
    totalDurationMs: 230,
    timestamp: '2026-03-16T00:00:00.000Z',
  };
}

function makeDiffs(): EvalDiff[] {
  return [
    {evalName: 'test-alpha', status: 'regressed', currentPassed: false, baselinePassed: true, assertionChanges: []},
    {evalName: 'test-beta', status: 'unchanged', currentPassed: true, baselinePassed: true, assertionChanges: []},
    {evalName: 'test-gamma', status: 'new', currentPassed: true, baselinePassed: null, assertionChanges: []},
  ];
}

describe('formatEvalTable', () => {
  it('produces terminal table with pass/fail counts', () => {
    const output = formatEvalTable(makeSuiteResult());
    expect(output).toContain('test-alpha');
    expect(output).toContain('test-beta');
    expect(output).toContain('PASS');
    expect(output).toContain('FAIL');
    expect(output).toContain('1/2');
    expect(output).toContain('1 passed, 1 failed');
  });
});

describe('formatDiffTable', () => {
  it('produces terminal diff table', () => {
    const output = formatDiffTable(makeDiffs());
    expect(output).toContain('regressed');
    expect(output).toContain('unchanged');
    expect(output).toContain('new');
    expect(output).toContain('1 regressed');
  });
});

describe('formatEvalMarkdown', () => {
  it('produces markdown table', () => {
    const output = formatEvalMarkdown(makeSuiteResult());
    expect(output).toContain('## Eval Results');
    expect(output).toContain('| test-alpha |');
    expect(output).toContain('**1 passed, 1 failed**');
  });

  it('includes diff section when diffs provided', () => {
    const output = formatEvalMarkdown(makeSuiteResult(), makeDiffs());
    expect(output).toContain('### Diff vs Baseline');
    expect(output).toContain('regressed');
    expect(output).toContain('**1 regression(s) detected**');
  });
});
