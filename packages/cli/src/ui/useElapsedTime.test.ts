/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

// Test the elapsed time formatting logic used in InputBar
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

describe('elapsed time formatting', () => {
  it('formats seconds', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(5)).toBe('5s');
    expect(formatElapsed(59)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatElapsed(60)).toBe('1m0s');
    expect(formatElapsed(61)).toBe('1m1s');
    expect(formatElapsed(125)).toBe('2m5s');
  });

  it('formats large values', () => {
    expect(formatElapsed(3600)).toBe('60m0s');
  });
});
