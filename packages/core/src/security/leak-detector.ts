/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ScrubRecord} from './security-types.js';
import type {ScrubTracker} from './scrub-tracker.js';

/**
 * A detected leak of a previously scrubbed value.
 */
export interface LeakMatch {
  record: ScrubRecord;
  matchedText: string;
  contextual: boolean;
}

/**
 * Compares agent output against tracked scrubbed values to detect leaks.
 */
export class LeakDetector {
  private readonly tracker: ScrubTracker;

  constructor(tracker: ScrubTracker) {
    this.tracker = tracker;
  }

  detect(text: string): LeakMatch[] {
    const matches: LeakMatch[] = [];
    const records = this.tracker.getAllRecords();

    for (const record of records) {
      if (record.value.length < 2) continue;

      const index = text.indexOf(record.value);
      if (index === -1) continue;

      if (record.sensitivity === 'pii_name') {
        // Only flag pii_name if near entity name/ID context
        const contextStart = Math.max(0, index - 200);
        const contextEnd = Math.min(text.length, index + record.value.length + 200);
        const context = text.slice(contextStart, contextEnd);

        const hasEntityContext =
          context.toLowerCase().includes(record.entity.toLowerCase()) ||
          (record.entityId !== undefined &&
            context.includes(record.entityId));

        if (hasEntityContext) {
          matches.push({
            record,
            matchedText: record.value,
            contextual: true,
          });
        }
      } else {
        // pii_identifier, financial, etc.: always flag
        matches.push({
          record,
          matchedText: record.value,
          contextual: false,
        });
      }
    }

    return matches;
  }
}
