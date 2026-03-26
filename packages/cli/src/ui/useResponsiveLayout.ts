/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export interface ResponsiveLayout {
  isNarrow: boolean;
  contentWidth: number;
  toolCardWidth: number;
  showGutter: boolean;
}

const NARROW_THRESHOLD = 60;
const GUTTER_THRESHOLD = 80;
const MAX_TOOL_WIDTH = 80;
const NARROW_TOOL_WIDTH = 50;

/**
 * Returns layout parameters based on terminal column width.
 */
export function getResponsiveLayout(cols: number): ResponsiveLayout {
  const isNarrow = cols < NARROW_THRESHOLD;
  return {
    isNarrow,
    contentWidth: cols,
    toolCardWidth: isNarrow
      ? Math.min(cols - 4, NARROW_TOOL_WIDTH)
      : Math.min(cols - 4, MAX_TOOL_WIDTH),
    showGutter: cols >= GUTTER_THRESHOLD,
  };
}
