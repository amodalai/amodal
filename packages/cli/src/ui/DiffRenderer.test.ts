/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {isDiffContent, parseDiff} from './DiffRenderer.js';

describe('isDiffContent', () => {
  it('detects unified diff with hunk headers', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
+added line
 line 2`;
    expect(isDiffContent(diff)).toBe(true);
  });

  it('detects diff with only @@ markers', () => {
    expect(isDiffContent('@@ -1,3 +1,4 @@\n+added')).toBe(true);
  });

  it('detects diff with --- and +++ pair', () => {
    expect(isDiffContent('--- a/old\n+++ b/new')).toBe(true);
  });

  it('rejects non-diff content', () => {
    expect(isDiffContent('just some text')).toBe(false);
    expect(isDiffContent('hello\nworld')).toBe(false);
  });

  it('rejects content with only ---', () => {
    expect(isDiffContent('--- separator\nsome content')).toBe(false);
  });
});

describe('parseDiff', () => {
  it('parses a simple unified diff', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 context line
+added line
 another context
-removed line`;
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.header).toBe('@@ -1,3 +1,4 @@');
    expect(hunks[0]?.lines).toHaveLength(4);
  });

  it('parses multiple hunks', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line 1
-old
+new
@@ -10,3 +10,3 @@
 line 10
-old2
+new2`;
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(2);
  });

  it('includes line numbers', () => {
    const diff = `@@ -5,3 +5,4 @@
 context
+added
 more context
-removed`;
    const hunks = parseDiff(diff);
    const lines = hunks[0]?.lines ?? [];
    // First context line: old=5, new=5
    expect(lines[0]?.oldLine).toBe(5);
    expect(lines[0]?.newLine).toBe(5);
    // Added line: no old, new=6
    expect(lines[1]?.oldLine).toBeNull();
    expect(lines[1]?.newLine).toBe(6);
    // Context: old=6, new=7
    expect(lines[2]?.oldLine).toBe(6);
    expect(lines[2]?.newLine).toBe(7);
    // Removed: old=7, no new
    expect(lines[3]?.oldLine).toBe(7);
    expect(lines[3]?.newLine).toBeNull();
  });

  it('returns empty for non-diff input', () => {
    expect(parseDiff('not a diff')).toHaveLength(0);
  });

  it('detects file extension from headers', () => {
    const diff = `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,1 +1,1 @@
-old
+new`;
    const hunks = parseDiff(diff);
    expect(hunks[0]?.fileExt).toBe('ts');
  });
});
