/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {evaluateCondition, resolveTtl} from './ttl-resolver.js';

describe('evaluateCondition', () => {
  it('evaluates IN condition (match)', () => {
    expect(evaluateCondition("severity IN ['P1', 'P2']", {severity: 'P1'})).toBe(true);
  });

  it('evaluates IN condition (no match)', () => {
    expect(evaluateCondition("severity IN ['P1', 'P2']", {severity: 'P3'})).toBe(false);
  });

  it('evaluates equality condition', () => {
    expect(evaluateCondition("status = 'active'", {status: 'active'})).toBe(true);
    expect(evaluateCondition("status = 'active'", {status: 'resolved'})).toBe(false);
  });

  it('evaluates inequality condition', () => {
    expect(evaluateCondition("status != 'resolved'", {status: 'active'})).toBe(true);
    expect(evaluateCondition("status != 'resolved'", {status: 'resolved'})).toBe(false);
  });

  it('handles missing fields', () => {
    expect(evaluateCondition("severity IN ['P1']", {})).toBe(false);
  });

  it('returns false for unknown condition syntax', () => {
    expect(evaluateCondition('something weird', {severity: 'P1'})).toBe(false);
  });

  it('handles double-quoted values in IN', () => {
    expect(evaluateCondition('severity IN ["P1", "P2"]', {severity: 'P1'})).toBe(true);
  });
});

describe('resolveTtl', () => {
  it('returns undefined when no TTL configured', () => {
    expect(resolveTtl(undefined, {})).toBeUndefined();
  });

  it('returns simple number TTL', () => {
    expect(resolveTtl(86400, {})).toBe(86400);
  });

  it('returns default TTL when no override matches', () => {
    const config = {
      default: 86400,
      override: [{condition: "severity IN ['P1']", ttl: 300}],
    };
    expect(resolveTtl(config, {severity: 'P3'})).toBe(86400);
  });

  it('returns override TTL when condition matches', () => {
    const config = {
      default: 86400,
      override: [{condition: "severity IN ['P1', 'P2']", ttl: 300}],
    };
    expect(resolveTtl(config, {severity: 'P1'})).toBe(300);
  });

  it('returns first matching override', () => {
    const config = {
      default: 86400,
      override: [
        {condition: "severity IN ['P1']", ttl: 60},
        {condition: "severity IN ['P1', 'P2']", ttl: 300},
      ],
    };
    expect(resolveTtl(config, {severity: 'P1'})).toBe(60);
  });

  it('returns default when no overrides defined', () => {
    expect(resolveTtl({default: 3600}, {})).toBe(3600);
  });
});
