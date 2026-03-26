/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

// Test scroll clamping logic independently from the React hook
function clampScroll(
  scrollTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(scrollTop, maxScroll));
}

function isAtBottom(
  scrollTop: number,
  contentHeight: number,
  viewportHeight: number,
): boolean {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return scrollTop >= maxScroll || contentHeight <= viewportHeight;
}

function autoScrollTarget(
  currentTop: number,
  wasAtBottom: boolean,
  contentHeight: number,
  viewportHeight: number,
): number {
  if (!wasAtBottom) return currentTop;
  return Math.max(0, contentHeight - viewportHeight);
}

describe('scroll clamping', () => {
  it('clamps to zero minimum', () => {
    expect(clampScroll(-10, 100, 50)).toBe(0);
  });

  it('clamps to max scroll', () => {
    // max = 100 - 50 = 50
    expect(clampScroll(60, 100, 50)).toBe(50);
  });

  it('allows valid scroll positions', () => {
    expect(clampScroll(25, 100, 50)).toBe(25);
  });

  it('handles content smaller than viewport', () => {
    expect(clampScroll(10, 30, 50)).toBe(0);
  });

  it('handles equal content and viewport', () => {
    expect(clampScroll(5, 50, 50)).toBe(0);
  });
});

describe('isAtBottom', () => {
  it('is true when scrolled to max', () => {
    expect(isAtBottom(50, 100, 50)).toBe(true);
  });

  it('is true when content fits viewport', () => {
    expect(isAtBottom(0, 30, 50)).toBe(true);
  });

  it('is false when not at max', () => {
    expect(isAtBottom(25, 100, 50)).toBe(false);
  });

  it('is true at exact max', () => {
    expect(isAtBottom(50, 100, 50)).toBe(true);
  });

  it('is true beyond max', () => {
    expect(isAtBottom(60, 100, 50)).toBe(true);
  });
});

describe('autoScrollTarget', () => {
  it('auto-scrolls when at bottom', () => {
    expect(autoScrollTarget(50, true, 120, 50)).toBe(70);
  });

  it('stays put when not at bottom', () => {
    expect(autoScrollTarget(25, false, 120, 50)).toBe(25);
  });

  it('handles growing content from empty', () => {
    expect(autoScrollTarget(0, true, 60, 50)).toBe(10);
  });

  it('stays at 0 when content fits', () => {
    expect(autoScrollTarget(0, true, 30, 50)).toBe(0);
  });
});
