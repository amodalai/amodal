/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {computeLineDiff, MAX_DIFF_LINES} from './lineDiff';

describe('computeLineDiff', () => {
  it('returns empty array when inputs are identical', () => {
    expect(computeLineDiff('hello\nworld', 'hello\nworld')).toEqual([]);
  });

  it('returns empty array for two empty strings', () => {
    expect(computeLineDiff('', '')).toEqual([]);
  });

  it('marks all lines as add when before is empty', () => {
    const diff = computeLineDiff('', 'a\nb');
    // splitting '' on '\n' gives [''], so we get one context-empty + two adds.
    // Verify the adds are present.
    const adds = diff.filter((l) => l.type === 'add').map((l) => l.text);
    expect(adds).toEqual(['a', 'b']);
  });

  it('marks all lines as remove when after is empty', () => {
    const diff = computeLineDiff('a\nb', '');
    const removes = diff.filter((l) => l.type === 'remove').map((l) => l.text);
    expect(removes).toEqual(['a', 'b']);
  });

  it('detects a single line addition', () => {
    const before = 'line1\nline2\nline3';
    const after = 'line1\nline2\nline2.5\nline3';
    const diff = computeLineDiff(before, after);
    const adds = diff.filter((l) => l.type === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0]?.text).toBe('line2.5');
  });

  it('detects a single line removal', () => {
    const before = 'line1\nline2\nline3';
    const after = 'line1\nline3';
    const diff = computeLineDiff(before, after);
    const removes = diff.filter((l) => l.type === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0]?.text).toBe('line2');
  });

  it('detects a single line modification (remove + add)', () => {
    const before = 'line1\nold\nline3';
    const after = 'line1\nnew\nline3';
    const diff = computeLineDiff(before, after);
    const removes = diff.filter((l) => l.type === 'remove');
    const adds = diff.filter((l) => l.type === 'add');
    expect(removes.map((l) => l.text)).toEqual(['old']);
    expect(adds.map((l) => l.text)).toEqual(['new']);
  });

  it('preserves context lines around changes', () => {
    const before = 'a\nb\nc';
    const after = 'a\nB\nc';
    const diff = computeLineDiff(before, after);
    expect(diff).toEqual([
      {type: 'context', text: 'a'},
      {type: 'remove', text: 'b'},
      {type: 'add', text: 'B'},
      {type: 'context', text: 'c'},
    ]);
  });

  it('handles multi-line additions', () => {
    const before = 'a\nz';
    const after = 'a\nb\nc\nd\nz';
    const diff = computeLineDiff(before, after);
    const adds = diff.filter((l) => l.type === 'add').map((l) => l.text);
    expect(adds).toEqual(['b', 'c', 'd']);
  });

  it('handles multi-line removals', () => {
    const before = 'a\nb\nc\nd\nz';
    const after = 'a\nz';
    const diff = computeLineDiff(before, after);
    const removes = diff.filter((l) => l.type === 'remove').map((l) => l.text);
    expect(removes).toEqual(['b', 'c', 'd']);
  });

  it('handles complex interleaved changes', () => {
    const before = 'line1\nline2\nline3\nline4\nline5';
    const after = 'line1\nlineA\nline3\nlineB\nline5';
    const diff = computeLineDiff(before, after);
    // Expect: context line1, remove line2, add lineA, context line3,
    //         remove line4, add lineB, context line5
    expect(diff).toEqual([
      {type: 'context', text: 'line1'},
      {type: 'remove', text: 'line2'},
      {type: 'add', text: 'lineA'},
      {type: 'context', text: 'line3'},
      {type: 'remove', text: 'line4'},
      {type: 'add', text: 'lineB'},
      {type: 'context', text: 'line5'},
    ]);
  });

  it('handles realistic skill prompt edits', () => {
    const before = `When a customer asks about pricing,
- check the pricing connection first.

Always include a link to the pricing page.`;
    const after = `When a customer asks about pricing,
- check the pricing connection first, then
- verify their subscription tier before
- quoting specific numbers.

Always include a link to the pricing page.`;
    const diff = computeLineDiff(before, after);
    const adds = diff.filter((l) => l.type === 'add');
    const removes = diff.filter((l) => l.type === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0]?.text).toBe('- check the pricing connection first.');
    expect(adds.map((l) => l.text)).toEqual([
      '- check the pricing connection first, then',
      '- verify their subscription tier before',
      '- quoting specific numbers.',
    ]);
  });

  it('preserves order: context, removes, adds, more context', () => {
    const before = 'header\nold1\nold2\nfooter';
    const after = 'header\nnew1\nnew2\nfooter';
    const diff = computeLineDiff(before, after);
    // First line is context, last line is context, middle is changes
    expect(diff[0]).toEqual({type: 'context', text: 'header'});
    expect(diff[diff.length - 1]).toEqual({type: 'context', text: 'footer'});
  });

  it('returns a truncated sentinel when before exceeds MAX_DIFF_LINES', () => {
    const before = Array.from({length: MAX_DIFF_LINES + 1}, (_, i) => `line${String(i)}`).join('\n');
    const after = 'line0';
    const diff = computeLineDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.type).toBe('truncated');
    expect(diff[0]?.text).toContain('Diff too large');
  });

  it('returns a truncated sentinel when after exceeds MAX_DIFF_LINES', () => {
    const before = 'line0';
    const after = Array.from({length: MAX_DIFF_LINES + 1}, (_, i) => `line${String(i)}`).join('\n');
    const diff = computeLineDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.type).toBe('truncated');
  });

  it('does not truncate when both inputs are exactly at MAX_DIFF_LINES', () => {
    const before = Array.from({length: MAX_DIFF_LINES}, (_, i) => `a${String(i)}`).join('\n');
    const after = Array.from({length: MAX_DIFF_LINES}, (_, i) => `b${String(i)}`).join('\n');
    const diff = computeLineDiff(before, after);
    // Should produce real diff lines, not the truncated sentinel
    expect(diff[0]?.type).not.toBe('truncated');
  });
});
