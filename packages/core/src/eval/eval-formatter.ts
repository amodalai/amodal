/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalSuiteResult, EvalDiff, EvalModelInfo} from './eval-types.js';
import {formatCostMicros} from './eval-cost.js';

/**
 * Format eval results as a terminal table with token usage and cost.
 */
export function formatEvalTable(result: EvalSuiteResult, model?: EvalModelInfo): string {
  const lines: string[] = [];
  const nameWidth = Math.max(20, ...result.results.map((r) => r.eval.name.length));
  const hasUsage = result.results.some((r) => r.cost);

  // Header
  if (model) {
    lines.push('');
    lines.push(`Model: ${model.provider}/${model.model}`);
  }
  lines.push('');

  if (hasUsage) {
    lines.push(`${'Eval'.padEnd(nameWidth)}  Status   Assertions  Tokens       Cost       Duration`);
    lines.push('-'.repeat(nameWidth + 70));
  } else {
    lines.push(`${'Eval'.padEnd(nameWidth)}  Status   Assertions  Duration`);
    lines.push('-'.repeat(nameWidth + 40));
  }

  for (const r of result.results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const passedCount = r.assertions.filter((a) => a.passed).length;
    const totalCount = r.assertions.length;
    const duration = `${r.durationMs}ms`;

    if (hasUsage && r.cost) {
      const tokens = `${r.cost.totalTokens.toLocaleString()}`;
      const cost = formatCostMicros(r.cost.estimatedCostMicros);
      lines.push(
        `${r.eval.name.padEnd(nameWidth)}  ${status.padEnd(7)}  ${`${passedCount}/${totalCount}`.padEnd(12)}${tokens.padEnd(13)}${cost.padEnd(11)}${duration}`,
      );
    } else {
      lines.push(
        `${r.eval.name.padEnd(nameWidth)}  ${status.padEnd(7)}  ${passedCount}/${totalCount}`.padEnd(nameWidth + 20) +
        `         ${duration}`,
      );
    }

    // Show per-assertion detail for failed evals
    if (!r.passed) {
      for (const a of r.assertions) {
        const icon = a.passed ? '  ✓' : '  ✗';
        const reason = a.reason ? ` — ${a.reason}` : '';
        lines.push(`${icon} ${a.negated ? 'NOT ' : ''}${a.text}${reason}`);
      }
    }
  }

  lines.push('-'.repeat(hasUsage ? nameWidth + 70 : nameWidth + 40));

  // Summary line
  const totalAssertions = result.results.reduce((n, r) => n + r.assertions.length, 0);
  const passedAssertions = result.results.reduce((n, r) => n + r.assertions.filter((a) => a.passed).length, 0);
  const accuracy = totalAssertions > 0 ? ((passedAssertions / totalAssertions) * 100).toFixed(0) : '0';
  lines.push(`Total: ${result.totalPassed} passed, ${result.totalFailed} failed (${result.totalDurationMs}ms)`);
  lines.push(`Accuracy: ${passedAssertions}/${totalAssertions} assertions (${accuracy}%)`);

  if (result.totalCost) {
    const cost = formatCostMicros(result.totalCost.estimatedCostMicros);
    lines.push(`Tokens: ${result.totalCost.totalTokens.toLocaleString()} (${result.totalCost.inputTokens.toLocaleString()} in / ${result.totalCost.outputTokens.toLocaleString()} out)`);
    lines.push(`Cost: ${cost}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format eval diff as a terminal table.
 */
export function formatDiffTable(diffs: EvalDiff[]): string {
  const lines: string[] = [];
  const nameWidth = Math.max(20, ...diffs.map((d) => d.evalName.length));

  lines.push('');
  lines.push(`${'Eval'.padEnd(nameWidth)}  Status       Current  Baseline`);
  lines.push('-'.repeat(nameWidth + 40));

  for (const d of diffs) {
    const icon = statusIcon(d.status);
    const current = d.currentPassed === null ? '-' : d.currentPassed ? 'PASS' : 'FAIL';
    const baseline = d.baselinePassed === null ? '-' : d.baselinePassed ? 'PASS' : 'FAIL';

    lines.push(
      `${d.evalName.padEnd(nameWidth)}  ${icon} ${d.status.padEnd(10)}  ${current.padEnd(7)}  ${baseline}`,
    );
  }

  const regressed = diffs.filter((d) => d.status === 'regressed').length;
  const improved = diffs.filter((d) => d.status === 'improved').length;
  const unchanged = diffs.filter((d) => d.status === 'unchanged').length;

  lines.push('-'.repeat(nameWidth + 40));
  lines.push(`Summary: ${regressed} regressed, ${improved} improved, ${unchanged} unchanged`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a side-by-side comparison of two eval suite results.
 * Shows model, accuracy, tokens, cost, and duration for each eval.
 */
export function formatComparisonTable(
  current: EvalSuiteResult,
  baseline: EvalSuiteResult,
  diffs: EvalDiff[],
): string {
  const lines: string[] = [];
  const currentModel = current.model ? `${current.model.provider}/${current.model.model}` : 'current';
  const baselineModel = baseline.model ? `${baseline.model.provider}/${baseline.model.model}` : 'baseline';
  const nameWidth = Math.max(20, ...diffs.map((d) => d.evalName.length));
  const colWidth = Math.max(30, baselineModel.length + 4, currentModel.length + 4);
  const sep = '-'.repeat(nameWidth + 4 + colWidth * 2);

  // Header
  lines.push('');
  lines.push(`${''.padEnd(nameWidth + 4)}${baselineModel.padEnd(colWidth)}${currentModel.padEnd(colWidth)}`);
  lines.push(sep);

  // Per-eval rows
  const baseMap = new Map(baseline.results.map((r) => [r.eval.name, r]));
  const curMap = new Map(current.results.map((r) => [r.eval.name, r]));

  for (const d of diffs) {
    const base = baseMap.get(d.evalName);
    const cur = curMap.get(d.evalName);
    const icon = statusIcon(d.status);

    const baseAssertions = base ? `${base.assertions.filter((a) => a.passed).length}/${base.assertions.length}` : '-';
    const curAssertions = cur ? `${cur.assertions.filter((a) => a.passed).length}/${cur.assertions.length}` : '-';
    const baseStatus = base ? (base.passed ? 'PASS' : 'FAIL') : '-';
    const curStatus = cur ? (cur.passed ? 'PASS' : 'FAIL') : '-';
    const baseTokens = base?.cost ? base.cost.totalTokens.toLocaleString() : '-';
    const curTokens = cur?.cost ? cur.cost.totalTokens.toLocaleString() : '-';
    const baseCost = base?.cost ? formatCostMicros(base.cost.estimatedCostMicros) : '-';
    const curCost = cur?.cost ? formatCostMicros(cur.cost.estimatedCostMicros) : '-';
    const baseDuration = base ? `${(base.durationMs / 1000).toFixed(1)}s` : '-';
    const curDuration = cur ? `${(cur.durationMs / 1000).toFixed(1)}s` : '-';

    lines.push(`${`${icon} ${d.evalName}`.padEnd(nameWidth + 4)}${`${baseStatus} ${baseAssertions}`.padEnd(colWidth)}${`${curStatus} ${curAssertions}`.padEnd(colWidth)}`);
    lines.push(`${''.padEnd(nameWidth + 4)}${`${baseTokens} tok ${baseCost}`.padEnd(colWidth)}${`${curTokens} tok ${curCost}`.padEnd(colWidth)}`);
    lines.push(`${''.padEnd(nameWidth + 4)}${baseDuration.padEnd(colWidth)}${curDuration.padEnd(colWidth)}`);
  }

  lines.push(sep);

  // Totals
  const baseTotal = baseline.results.length;
  const curTotal = current.results.length;
  const basePassed = baseline.totalPassed;
  const curPassed = current.totalPassed;
  const baseAssTotal = baseline.results.reduce((n, r) => n + r.assertions.length, 0);
  const baseAssPassed = baseline.results.reduce((n, r) => n + r.assertions.filter((a) => a.passed).length, 0);
  const curAssTotal = current.results.reduce((n, r) => n + r.assertions.length, 0);
  const curAssPassed = current.results.reduce((n, r) => n + r.assertions.filter((a) => a.passed).length, 0);
  const baseAccuracy = baseAssTotal > 0 ? ((baseAssPassed / baseAssTotal) * 100).toFixed(0) : '0';
  const curAccuracy = curAssTotal > 0 ? ((curAssPassed / curAssTotal) * 100).toFixed(0) : '0';

  lines.push(`${'Evals'.padEnd(nameWidth + 4)}${`${basePassed}/${baseTotal} passed`.padEnd(colWidth)}${`${curPassed}/${curTotal} passed`.padEnd(colWidth)}`);
  lines.push(`${'Accuracy'.padEnd(nameWidth + 4)}${`${baseAccuracy}% (${baseAssPassed}/${baseAssTotal})`.padEnd(colWidth)}${`${curAccuracy}% (${curAssPassed}/${curAssTotal})`.padEnd(colWidth)}`);

  if (baseline.totalCost || current.totalCost) {
    const baseTok = baseline.totalCost ? baseline.totalCost.totalTokens.toLocaleString() : '-';
    const curTok = current.totalCost ? current.totalCost.totalTokens.toLocaleString() : '-';
    const baseCostTotal = baseline.totalCost ? formatCostMicros(baseline.totalCost.estimatedCostMicros) : '-';
    const curCostTotal = current.totalCost ? formatCostMicros(current.totalCost.estimatedCostMicros) : '-';
    lines.push(`${'Tokens'.padEnd(nameWidth + 4)}${baseTok.padEnd(colWidth)}${curTok.padEnd(colWidth)}`);
    lines.push(`${'Cost'.padEnd(nameWidth + 4)}${baseCostTotal.padEnd(colWidth)}${curCostTotal.padEnd(colWidth)}`);
  }

  const baseDurTotal = `${(baseline.totalDurationMs / 1000).toFixed(1)}s`;
  const curDurTotal = `${(current.totalDurationMs / 1000).toFixed(1)}s`;
  lines.push(`${'Duration'.padEnd(nameWidth + 4)}${baseDurTotal.padEnd(colWidth)}${curDurTotal.padEnd(colWidth)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format eval results as CI-friendly markdown.
 */
export function formatEvalMarkdown(result: EvalSuiteResult, diffs?: EvalDiff[], model?: EvalModelInfo): string {
  const lines: string[] = [];

  lines.push('## Eval Results');
  if (model) {
    lines.push(`**Model:** ${model.provider}/${model.model}`);
  }
  lines.push('');

  const hasUsage = result.results.some((r) => r.cost);
  if (hasUsage) {
    lines.push(`| Eval | Status | Assertions | Tokens | Cost | Duration |`);
    lines.push(`|------|--------|------------|--------|------|----------|`);
  } else {
    lines.push(`| Eval | Status | Assertions | Duration |`);
    lines.push(`|------|--------|------------|----------|`);
  }

  for (const r of result.results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const passedCount = r.assertions.filter((a) => a.passed).length;
    if (hasUsage && r.cost) {
      const cost = formatCostMicros(r.cost.estimatedCostMicros);
      lines.push(`| ${r.eval.name} | ${status} | ${passedCount}/${r.assertions.length} | ${r.cost.totalTokens.toLocaleString()} | ${cost} | ${r.durationMs}ms |`);
    } else {
      lines.push(`| ${r.eval.name} | ${status} | ${passedCount}/${r.assertions.length} | ${r.durationMs}ms |`);
    }
  }

  const totalAssertions = result.results.reduce((n, r) => n + r.assertions.length, 0);
  const passedAssertions = result.results.reduce((n, r) => n + r.assertions.filter((a) => a.passed).length, 0);
  const accuracy = totalAssertions > 0 ? ((passedAssertions / totalAssertions) * 100).toFixed(0) : '0';

  lines.push('');
  lines.push(`**${result.totalPassed} passed, ${result.totalFailed} failed** (${result.totalDurationMs}ms) — **${accuracy}% accuracy** (${passedAssertions}/${totalAssertions})`);

  if (result.totalCost) {
    const cost = formatCostMicros(result.totalCost.estimatedCostMicros);
    lines.push(`**Tokens:** ${result.totalCost.totalTokens.toLocaleString()} — **Cost:** ${cost}`);
  }

  if (diffs && diffs.length > 0) {
    lines.push('');
    lines.push('### Diff vs Baseline');
    lines.push('');
    lines.push('| Eval | Status | Current | Baseline |');
    lines.push('|------|--------|---------|----------|');

    for (const d of diffs) {
      const icon = statusIcon(d.status);
      const current = d.currentPassed === null ? '-' : d.currentPassed ? 'PASS' : 'FAIL';
      const baseline = d.baselinePassed === null ? '-' : d.baselinePassed ? 'PASS' : 'FAIL';
      lines.push(`| ${d.evalName} | ${icon} ${d.status} | ${current} | ${baseline} |`);
    }

    const regressed = diffs.filter((d) => d.status === 'regressed').length;
    if (regressed > 0) {
      lines.push('');
      lines.push(`**${regressed} regression(s) detected**`);
    }
  }

  return lines.join('\n');
}

function statusIcon(status: string): string {
  switch (status) {
    case 'improved': return '+';
    case 'regressed': return '!';
    case 'new': return '*';
    case 'removed': return '-';
    default: return '=';
  }
}
