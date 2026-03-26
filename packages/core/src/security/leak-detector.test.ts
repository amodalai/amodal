/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {LeakDetector} from './leak-detector.js';
import {ScrubTracker} from './scrub-tracker.js';
import type {ScrubRecord} from './security-types.js';

function makeRecord(overrides: Partial<ScrubRecord> = {}): ScrubRecord {
  return {
    value: 'secret-value',
    entity: 'contact',
    field: 'ssn',
    sensitivity: 'pii_identifier',
    policy: 'never_retrieve',
    connectionName: 'crm',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('LeakDetector', () => {
  let tracker: ScrubTracker;
  let detector: LeakDetector;

  beforeEach(() => {
    tracker = new ScrubTracker();
    detector = new LeakDetector(tracker);
  });

  it('returns empty for clean text', () => {
    tracker.addRecords([makeRecord({value: '123-45-6789'})]);
    const leaks = detector.detect('No sensitive data here');
    expect(leaks).toHaveLength(0);
  });

  it('detects pii_identifier leak always', () => {
    tracker.addRecords([
      makeRecord({value: '123-45-6789', sensitivity: 'pii_identifier'}),
    ]);
    const leaks = detector.detect('The SSN is 123-45-6789');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.contextual).toBe(false);
  });

  it('detects pii_name only with entity context', () => {
    tracker.addRecords([
      makeRecord({
        value: 'John Doe',
        sensitivity: 'pii_name',
        entity: 'contact',
      }),
    ]);

    // Without entity context — no detection
    const noContext = detector.detect('John Doe is here');
    expect(noContext).toHaveLength(0);

    // With entity context — detection
    const withContext = detector.detect(
      'The contact record shows John Doe as the primary',
    );
    expect(withContext).toHaveLength(1);
    expect(withContext[0]?.contextual).toBe(true);
  });

  it('detects pii_name with entityId context', () => {
    tracker.addRecords([
      makeRecord({
        value: 'Jane Smith',
        sensitivity: 'pii_name',
        entity: 'contact',
        entityId: 'C-12345',
      }),
    ]);

    const leaks = detector.detect('Record C-12345 belongs to Jane Smith');
    expect(leaks).toHaveLength(1);
  });

  it('detects financial sensitivity always', () => {
    tracker.addRecords([
      makeRecord({value: '150000', sensitivity: 'financial'}),
    ]);
    const leaks = detector.detect('Salary: 150000');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.contextual).toBe(false);
  });

  it('ignores very short values', () => {
    tracker.addRecords([makeRecord({value: 'a'})]);
    const leaks = detector.detect('a is a letter');
    expect(leaks).toHaveLength(0);
  });

  it('detects multiple leaks', () => {
    tracker.addRecords([
      makeRecord({value: '111-22-3333', sensitivity: 'pii_identifier'}),
      makeRecord({value: '444-55-6666', sensitivity: 'pii_identifier'}),
    ]);
    const leaks = detector.detect(
      'Found 111-22-3333 and 444-55-6666',
    );
    expect(leaks).toHaveLength(2);
  });

  it('returns empty when tracker is empty', () => {
    const leaks = detector.detect('anything here');
    expect(leaks).toHaveLength(0);
  });

  it('handles empty text', () => {
    tracker.addRecords([makeRecord()]);
    const leaks = detector.detect('');
    expect(leaks).toHaveLength(0);
  });

  it('detects custom sensitivity types always', () => {
    tracker.addRecords([
      makeRecord({value: 'SECRET-KEY-123', sensitivity: 'api_key'}),
    ]);
    const leaks = detector.detect('The key is SECRET-KEY-123');
    expect(leaks).toHaveLength(1);
  });

  it('pii_name without context within 200 chars is not detected', () => {
    tracker.addRecords([
      makeRecord({
        value: 'John Doe',
        sensitivity: 'pii_name',
        entity: 'contact',
      }),
    ]);

    // Entity name is more than 200 chars away
    const padding = 'x'.repeat(300);
    const leaks = detector.detect(`contact ${padding} John Doe`);
    expect(leaks).toHaveLength(0);
  });

  it('returns matched text in leak result', () => {
    tracker.addRecords([
      makeRecord({value: '123-45-6789', sensitivity: 'pii_identifier'}),
    ]);
    const leaks = detector.detect('SSN: 123-45-6789');
    expect(leaks[0]?.matchedText).toBe('123-45-6789');
  });

  it('includes the original record in leak result', () => {
    const record = makeRecord({
      value: '123-45-6789',
      sensitivity: 'pii_identifier',
    });
    tracker.addRecords([record]);
    const leaks = detector.detect('SSN: 123-45-6789');
    expect(leaks[0]?.record).toBe(record);
  });
});
