/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Line-based unified diff using the longest-common-subsequence algorithm.
 *
 * Outputs a sequence of `add`, `remove`, and `context` lines suitable for
 * rendering a unified diff view. Sufficient for the actual use cases
 * (markdown skill prompts, knowledge docs, JSON config files) without
 * pulling in a heavyweight diff library.
 *
 * For very large inputs the LCS table is O(n*m) memory. The component caps
 * the rendered output at a configurable number of lines, but if the inputs
 * themselves are huge (e.g. 10k+ lines each) we'll still allocate the
 * table. Acceptable for the agent config files we expect to diff.
 */

export type DiffLineType = 'add' | 'remove' | 'context' | 'truncated';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Maximum line count on either side before we bail out of the LCS computation.
 *
 * The LCS table is O(n*m) memory. At 5000 lines on each side that's 25M
 * entries — fine in a browser. At 50k it's 2.5B and the tab dies. The cap
 * is set well below the failure point so the diff degrades gracefully into
 * a "too large" sentinel rather than freezing the UI.
 */
export const MAX_DIFF_LINES = 5000;

/**
 * Compute a line-based diff between two strings.
 *
 * Returns an array of `DiffLine`s where:
 *  - `add`       — line is in `after` but not in `before`
 *  - `remove`    — line is in `before` but not in `after`
 *  - `context`   — line is in both, unchanged
 *  - `truncated` — sentinel returned when either input exceeds MAX_DIFF_LINES.
 *                  Callers should render a "too large to diff" message.
 *
 * If both inputs are identical, returns an empty array (signal to the
 * caller that there are no changes to render).
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  if (before === after) return [];

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  // Bail out for inputs that would blow up the LCS table.
  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    return [{
      type: 'truncated',
      text: `Diff too large to render (${beforeLines.length.toLocaleString()} → ${afterLines.length.toLocaleString()} lines, max ${MAX_DIFF_LINES.toLocaleString()})`,
    }];
  }

  // Build LCS table
  const lcs = buildLcsTable(beforeLines, afterLines);

  // Walk back through the table to produce the diff
  return backtrack(lcs, beforeLines, afterLines);
}

/**
 * Build the LCS length table. lcs[i][j] is the length of the longest common
 * subsequence of beforeLines[0..i-1] and afterLines[0..j-1].
 */
function buildLcsTable(beforeLines: string[], afterLines: string[]): number[][] {
  const m = beforeLines.length;
  const n = afterLines.length;
  // Allocate (m+1) x (n+1) table initialized to 0. Each row is constructed
  // by Array.from so we know table[i] is always a defined number[].
  const table: number[][] = Array.from({length: m + 1}, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    const row = table[i];
    const prevRow = table[i - 1];
    if (!row || !prevRow) continue;
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }
  return table;
}

/**
 * Walk back through the LCS table to produce the diff lines in order.
 *
 * The comparison uses `>` (not `>=`) so that when both directions have equal
 * LCS length we prefer the left branch (`j--`, an add). Because we walk
 * backwards and unshift, processing the add first means it ends up AFTER
 * the corresponding remove in the final array. This matches the conventional
 * unified-diff convention of "remove before add" at any modified hunk.
 */
function backtrack(
  table: number[][],
  beforeLines: string[],
  afterLines: string[],
): DiffLine[] {
  const result: DiffLine[] = [];
  let i = beforeLines.length;
  let j = afterLines.length;

  while (i > 0 && j > 0) {
    if (beforeLines[i - 1] === afterLines[j - 1]) {
      result.unshift({type: 'context', text: beforeLines[i - 1] ?? ''});
      i--;
      j--;
    } else if ((table[i - 1]?.[j] ?? 0) > (table[i]?.[j - 1] ?? 0)) {
      result.unshift({type: 'remove', text: beforeLines[i - 1] ?? ''});
      i--;
    } else {
      result.unshift({type: 'add', text: afterLines[j - 1] ?? ''});
      j--;
    }
  }
  // Drain any remaining lines. Order matters: drain `j` (adds) FIRST so
  // they get unshifted first and end up AFTER any drained removes in the
  // result. This preserves "remove before add" at the start of the diff
  // when both inputs have unique prefixes.
  while (j > 0) {
    result.unshift({type: 'add', text: afterLines[j - 1] ?? ''});
    j--;
  }
  while (i > 0) {
    result.unshift({type: 'remove', text: beforeLines[i - 1] ?? ''});
    i--;
  }
  return result;
}
