/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ScrubRecord} from './security-types.js';

/**
 * Per-session accumulator of scrubbed field values.
 * The field scrubber writes records; the output guard reads them
 * to detect leaks in agent responses.
 */
export class ScrubTracker {
  private readonly records: ScrubRecord[] = [];
  private readonly values: Set<string> = new Set();

  addRecords(records: readonly ScrubRecord[]): void {
    for (const record of records) {
      this.records.push(record);
      if (record.value.length > 0) {
        this.values.add(record.value);
      }
    }
  }

  getAllRecords(): readonly ScrubRecord[] {
    return this.records;
  }

  getScrubbedValues(): ReadonlySet<string> {
    return this.values;
  }

  getRecordsBySensitivity(
    sensitivity: string,
  ): readonly ScrubRecord[] {
    return this.records.filter((r) => r.sensitivity === sensitivity);
  }

  clear(): void {
    this.records.length = 0;
    this.values.clear();
  }

  get size(): number {
    return this.records.length;
  }
}
