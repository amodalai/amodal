/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {Threshold} from '../repo/connection-schemas.js';

/**
 * Evaluates threshold escalation rules against request parameters.
 * Returns the highest triggered escalation, or null if none trigger.
 */
export class ThresholdEvaluator {
  evaluate(
    thresholds: Threshold[],
    params: Record<string, unknown>,
  ): 'review' | 'never' | null {
    // Sort descending by `above` so we check highest thresholds first
    const sorted = [...thresholds].sort((a, b) => b.above - a.above);

    for (const threshold of sorted) {
      const value = extractDotPath(params, threshold.field);
      if (value === undefined) continue;
      if (typeof value !== 'number') continue;

      if (value > threshold.above) {
        return threshold.escalate;
      }
    }

    return null;
  }
}

/**
 * Extracts a value from a nested object using dot-path notation.
 * e.g., "body.amount" extracts params.body.amount
 */
function extractDotPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- traversing unknown nested structure
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
