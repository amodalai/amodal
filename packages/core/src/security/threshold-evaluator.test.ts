/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {ThresholdEvaluator} from './threshold-evaluator.js';

describe('ThresholdEvaluator', () => {
  const evaluator = new ThresholdEvaluator();

  it('returns null when no thresholds', () => {
    const result = evaluator.evaluate([], {amount: 100});
    expect(result).toBeNull();
  });

  it('returns null when value is below all thresholds', () => {
    const result = evaluator.evaluate(
      [{field: 'amount', above: 10000, escalate: 'review'}],
      {amount: 500},
    );
    expect(result).toBeNull();
  });

  it('returns escalation when value exceeds threshold', () => {
    const result = evaluator.evaluate(
      [{field: 'amount', above: 10000, escalate: 'review'}],
      {amount: 15000},
    );
    expect(result).toBe('review');
  });

  it('returns highest triggered escalation', () => {
    const result = evaluator.evaluate(
      [
        {field: 'amount', above: 1000, escalate: 'review'},
        {field: 'amount', above: 50000, escalate: 'never'},
      ],
      {amount: 75000},
    );
    expect(result).toBe('never');
  });

  it('supports dot-path field extraction', () => {
    const result = evaluator.evaluate(
      [{field: 'body.amount', above: 10000, escalate: 'review'}],
      {body: {amount: 15000}},
    );
    expect(result).toBe('review');
  });

  it('skips threshold when field is missing', () => {
    const result = evaluator.evaluate(
      [{field: 'missing', above: 100, escalate: 'review'}],
      {amount: 15000},
    );
    expect(result).toBeNull();
  });

  it('skips threshold when value is non-numeric', () => {
    const result = evaluator.evaluate(
      [{field: 'name', above: 100, escalate: 'review'}],
      {name: 'John'},
    );
    expect(result).toBeNull();
  });

  it('returns lower escalation when only lower threshold triggers', () => {
    const result = evaluator.evaluate(
      [
        {field: 'amount', above: 1000, escalate: 'review'},
        {field: 'amount', above: 50000, escalate: 'never'},
      ],
      {amount: 5000},
    );
    expect(result).toBe('review');
  });

  it('handles equal value (not above)', () => {
    const result = evaluator.evaluate(
      [{field: 'amount', above: 10000, escalate: 'review'}],
      {amount: 10000},
    );
    expect(result).toBeNull(); // must be above, not equal
  });

  it('handles deeply nested dot-path', () => {
    const result = evaluator.evaluate(
      [{field: 'a.b.c', above: 5, escalate: 'never'}],
      {a: {b: {c: 10}}},
    );
    expect(result).toBe('never');
  });
});
