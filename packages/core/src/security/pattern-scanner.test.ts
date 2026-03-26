/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {PatternScanner} from './pattern-scanner.js';

describe('PatternScanner', () => {
  const scanner = new PatternScanner();

  describe('SSN detection', () => {
    it('detects standard SSN format', () => {
      const matches = scanner.scan('SSN is 123-45-6789');
      expect(matches).toHaveLength(1);
      expect(matches[0]?.pattern).toBe('ssn');
      expect(matches[0]?.match).toBe('123-45-6789');
    });

    it('detects multiple SSNs', () => {
      const matches = scanner.scan('First: 111-22-3333, Second: 444-55-6666');
      expect(matches).toHaveLength(2);
    });

    it('does not match partial SSN-like strings', () => {
      const matches = scanner.scan('phone: 123-456-7890');
      // phone number has different grouping
      const ssns = matches.filter((m) => m.pattern === 'ssn');
      expect(ssns).toHaveLength(0);
    });

    it('returns correct index', () => {
      const matches = scanner.scan('prefix 123-45-6789 suffix');
      expect(matches[0]?.index).toBe(7);
    });
  });

  describe('credit card detection', () => {
    it('detects valid Visa number', () => {
      // 4111111111111111 passes Luhn
      const matches = scanner.scan('Card: 4111111111111111');
      const cc = matches.filter((m) => m.pattern === 'credit_card');
      expect(cc).toHaveLength(1);
    });

    it('detects card with spaces', () => {
      const matches = scanner.scan('Card: 4111 1111 1111 1111');
      const cc = matches.filter((m) => m.pattern === 'credit_card');
      expect(cc).toHaveLength(1);
    });

    it('detects card with dashes', () => {
      const matches = scanner.scan('Card: 4111-1111-1111-1111');
      const cc = matches.filter((m) => m.pattern === 'credit_card');
      expect(cc).toHaveLength(1);
    });

    it('rejects invalid Luhn', () => {
      const matches = scanner.scan('Not a card: 1234567890123456');
      const cc = matches.filter((m) => m.pattern === 'credit_card');
      expect(cc).toHaveLength(0);
    });

    it('detects 13-digit card', () => {
      // 4222222222222 passes Luhn
      const matches = scanner.scan('Card: 4222222222222');
      const cc = matches.filter((m) => m.pattern === 'credit_card');
      expect(cc).toHaveLength(1);
    });
  });

  describe('bank account detection', () => {
    it('detects account number near keyword', () => {
      const matches = scanner.scan('Account number: 12345678');
      const bank = matches.filter((m) => m.pattern === 'bank_account');
      expect(bank).toHaveLength(1);
      expect(bank[0]?.match).toBe('12345678');
    });

    it('detects routing number near keyword', () => {
      const matches = scanner.scan('Routing: 123456789');
      const bank = matches.filter((m) => m.pattern === 'bank_account');
      expect(bank).toHaveLength(1);
    });

    it('does not flag digits without keyword context', () => {
      const matches = scanner.scan('ID: 12345678');
      const bank = matches.filter((m) => m.pattern === 'bank_account');
      expect(bank).toHaveLength(0);
    });

    it('detects acct abbreviation', () => {
      const matches = scanner.scan('Acct 87654321 is active');
      const bank = matches.filter((m) => m.pattern === 'bank_account');
      expect(bank).toHaveLength(1);
    });
  });

  it('detects multiple pattern types in one scan', () => {
    const text =
      'SSN: 123-45-6789, Card: 4111111111111111, Account: 12345678';
    const matches = scanner.scan(text);
    const types = new Set(matches.map((m) => m.pattern));
    expect(types.has('ssn')).toBe(true);
    expect(types.has('credit_card')).toBe(true);
    expect(types.has('bank_account')).toBe(true);
  });

  it('returns empty array for clean text', () => {
    const matches = scanner.scan('No sensitive data here.');
    expect(matches).toHaveLength(0);
  });

  it('handles empty string', () => {
    const matches = scanner.scan('');
    expect(matches).toHaveLength(0);
  });
});
