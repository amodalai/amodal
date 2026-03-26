/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {getResponsiveLayout} from './useResponsiveLayout.js';

describe('getResponsiveLayout', () => {
  it('narrow terminal (40 cols)', () => {
    const layout = getResponsiveLayout(40);
    expect(layout.isNarrow).toBe(true);
    expect(layout.contentWidth).toBe(40);
    expect(layout.toolCardWidth).toBe(36); // 40 - 4
    expect(layout.showGutter).toBe(false);
  });

  it('medium terminal (70 cols)', () => {
    const layout = getResponsiveLayout(70);
    expect(layout.isNarrow).toBe(false);
    expect(layout.contentWidth).toBe(70);
    expect(layout.toolCardWidth).toBe(66); // 70 - 4
    expect(layout.showGutter).toBe(false);
  });

  it('wide terminal (120 cols)', () => {
    const layout = getResponsiveLayout(120);
    expect(layout.isNarrow).toBe(false);
    expect(layout.contentWidth).toBe(120);
    expect(layout.toolCardWidth).toBe(80); // capped at 80
    expect(layout.showGutter).toBe(true);
  });

  it('exact narrow threshold (60 cols)', () => {
    const layout = getResponsiveLayout(60);
    expect(layout.isNarrow).toBe(false);
  });

  it('below narrow threshold (59 cols)', () => {
    const layout = getResponsiveLayout(59);
    expect(layout.isNarrow).toBe(true);
  });

  it('exact gutter threshold (80 cols)', () => {
    const layout = getResponsiveLayout(80);
    expect(layout.showGutter).toBe(true);
  });

  it('narrow terminal caps tool width at 50', () => {
    const layout = getResponsiveLayout(58);
    expect(layout.toolCardWidth).toBe(50); // min(58-4, 50)
  });
});
