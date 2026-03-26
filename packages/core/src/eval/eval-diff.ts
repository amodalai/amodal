/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalSuiteResult, EvalDiff, EvalDiffStatus} from './eval-types.js';

/**
 * Compare current eval results against a baseline.
 * Returns a diff for each eval case showing regressions, improvements, etc.
 */
export function diffEvalResults(
  current: EvalSuiteResult,
  baseline: EvalSuiteResult,
): EvalDiff[] {
  const currentMap = new Map(current.results.map((r) => [r.eval.name, r]));
  const baselineMap = new Map(baseline.results.map((r) => [r.eval.name, r]));
  const allNames = new Set([...currentMap.keys(), ...baselineMap.keys()]);
  const diffs: EvalDiff[] = [];

  for (const name of allNames) {
    const cur = currentMap.get(name);
    const base = baselineMap.get(name);

    if (cur && !base) {
      diffs.push({
        evalName: name,
        status: 'new',
        currentPassed: cur.passed,
        baselinePassed: null,
        assertionChanges: cur.assertions.map((a) => ({
          text: a.text,
          currentPassed: a.passed,
          baselinePassed: null,
          status: 'new' as EvalDiffStatus,
        })),
      });
      continue;
    }

    if (!cur && base) {
      diffs.push({
        evalName: name,
        status: 'removed',
        currentPassed: null,
        baselinePassed: base.passed,
        assertionChanges: base.assertions.map((a) => ({
          text: a.text,
          currentPassed: null,
          baselinePassed: a.passed,
          status: 'removed' as EvalDiffStatus,
        })),
      });
      continue;
    }

    if (cur && base) {
      const assertionChanges = diffAssertions(cur.assertions, base.assertions);
      let status: EvalDiffStatus = 'unchanged';

      if (cur.passed && !base.passed) {
        status = 'improved';
      } else if (!cur.passed && base.passed) {
        status = 'regressed';
      } else if (assertionChanges.some((a) => a.status !== 'unchanged')) {
        // Same overall pass/fail but assertion-level changes
        status = assertionChanges.some((a) => a.status === 'regressed') ? 'regressed' : 'improved';
      }

      diffs.push({
        evalName: name,
        status,
        currentPassed: cur.passed,
        baselinePassed: base.passed,
        assertionChanges,
      });
    }
  }

  return diffs;
}

function diffAssertions(
  current: Array<{text: string; passed: boolean}>,
  baseline: Array<{text: string; passed: boolean}>,
): Array<{text: string; currentPassed: boolean | null; baselinePassed: boolean | null; status: EvalDiffStatus}> {
  const baseMap = new Map(baseline.map((a) => [a.text, a.passed]));
  const curMap = new Map(current.map((a) => [a.text, a.passed]));
  const allTexts = new Set([...baseMap.keys(), ...curMap.keys()]);
  const result: Array<{text: string; currentPassed: boolean | null; baselinePassed: boolean | null; status: EvalDiffStatus}> = [];

  for (const text of allTexts) {
    const curPassed = curMap.get(text) ?? null;
    const basePassed = baseMap.get(text) ?? null;

    let status: EvalDiffStatus = 'unchanged';
    if (curPassed !== null && basePassed === null) {
      status = 'new';
    } else if (curPassed === null && basePassed !== null) {
      status = 'removed';
    } else if (curPassed === true && basePassed === false) {
      status = 'improved';
    } else if (curPassed === false && basePassed === true) {
      status = 'regressed';
    }

    result.push({text, currentPassed: curPassed, baselinePassed: basePassed, status});
  }

  return result;
}
