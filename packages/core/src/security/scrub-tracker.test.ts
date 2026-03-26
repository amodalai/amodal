/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {ScrubTracker} from './scrub-tracker.js';
import type {ScrubRecord} from './security-types.js';

function makeRecord(overrides: Partial<ScrubRecord> = {}): ScrubRecord {
  return {
    value: 'test-value',
    entity: 'contact',
    field: 'ssn',
    sensitivity: 'pii_identifier',
    policy: 'never_retrieve',
    connectionName: 'crm',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ScrubTracker', () => {
  let tracker: ScrubTracker;

  beforeEach(() => {
    tracker = new ScrubTracker();
  });

  it('starts empty', () => {
    expect(tracker.size).toBe(0);
    expect(tracker.getAllRecords()).toEqual([]);
    expect(tracker.getScrubbedValues().size).toBe(0);
  });

  it('adds records and tracks values', () => {
    const record = makeRecord({value: '123-45-6789'});
    tracker.addRecords([record]);

    expect(tracker.size).toBe(1);
    expect(tracker.getAllRecords()).toEqual([record]);
    expect(tracker.getScrubbedValues().has('123-45-6789')).toBe(true);
  });

  it('adds multiple records at once', () => {
    const r1 = makeRecord({value: 'val1', field: 'f1'});
    const r2 = makeRecord({value: 'val2', field: 'f2'});
    tracker.addRecords([r1, r2]);

    expect(tracker.size).toBe(2);
    expect(tracker.getScrubbedValues().size).toBe(2);
  });

  it('accumulates records across multiple calls', () => {
    tracker.addRecords([makeRecord({value: 'a'})]);
    tracker.addRecords([makeRecord({value: 'b'})]);

    expect(tracker.size).toBe(2);
    expect(tracker.getScrubbedValues().has('a')).toBe(true);
    expect(tracker.getScrubbedValues().has('b')).toBe(true);
  });

  it('deduplicates values in the set', () => {
    tracker.addRecords([makeRecord({value: 'same'})]);
    tracker.addRecords([makeRecord({value: 'same'})]);

    expect(tracker.size).toBe(2); // records are not deduped
    expect(tracker.getScrubbedValues().size).toBe(1); // values are
  });

  it('ignores empty string values in the set', () => {
    tracker.addRecords([makeRecord({value: ''})]);

    expect(tracker.size).toBe(1);
    expect(tracker.getScrubbedValues().size).toBe(0);
  });

  it('filters records by sensitivity', () => {
    tracker.addRecords([
      makeRecord({sensitivity: 'pii_identifier', field: 'ssn'}),
      makeRecord({sensitivity: 'pii_name', field: 'name'}),
      makeRecord({sensitivity: 'pii_identifier', field: 'ein'}),
    ]);

    const piiId = tracker.getRecordsBySensitivity('pii_identifier');
    expect(piiId).toHaveLength(2);

    const piiName = tracker.getRecordsBySensitivity('pii_name');
    expect(piiName).toHaveLength(1);

    const financial = tracker.getRecordsBySensitivity('financial');
    expect(financial).toHaveLength(0);
  });

  it('clear removes all records and values', () => {
    tracker.addRecords([makeRecord(), makeRecord({value: 'other'})]);
    expect(tracker.size).toBe(2);

    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.getAllRecords()).toEqual([]);
    expect(tracker.getScrubbedValues().size).toBe(0);
  });

  it('can be reused after clear', () => {
    tracker.addRecords([makeRecord()]);
    tracker.clear();
    tracker.addRecords([makeRecord({value: 'new'})]);

    expect(tracker.size).toBe(1);
    expect(tracker.getScrubbedValues().has('new')).toBe(true);
  });

  it('returns readonly arrays', () => {
    tracker.addRecords([makeRecord()]);
    const records = tracker.getAllRecords();
    expect(Array.isArray(records)).toBe(true);
  });

  it('returns readonly set for values', () => {
    tracker.addRecords([makeRecord()]);
    const values = tracker.getScrubbedValues();
    expect(values instanceof Set).toBe(true);
  });

  it('handles records with different connections', () => {
    tracker.addRecords([
      makeRecord({connectionName: 'crm', value: 'v1'}),
      makeRecord({connectionName: 'erp', value: 'v2'}),
    ]);

    expect(tracker.size).toBe(2);
    expect(tracker.getScrubbedValues().size).toBe(2);
  });

  it('handles records with entityId', () => {
    const record = makeRecord({entityId: 'C-12345'});
    tracker.addRecords([record]);

    expect(tracker.getAllRecords()[0]?.entityId).toBe('C-12345');
  });

  it('handles all three policy types', () => {
    tracker.addRecords([
      makeRecord({policy: 'never_retrieve'}),
      makeRecord({policy: 'retrieve_but_redact', value: 'r1'}),
      makeRecord({policy: 'role_gated', value: 'r2'}),
    ]);

    expect(tracker.size).toBe(3);
  });
});
