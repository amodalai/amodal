/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {OutputGuard} from './output-guard.js';
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

describe('OutputGuard', () => {
  let tracker: ScrubTracker;

  beforeEach(() => {
    tracker = new ScrubTracker();
  });

  it('passes through clean output', () => {
    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
    });

    const result = guard.guard('Everything looks normal');
    expect(result.output).toBe('Everything looks normal');
    expect(result.modified).toBe(false);
    expect(result.findings).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });

  describe('stage 1: field redaction', () => {
    it('redacts retrieve_but_redact values', () => {
      tracker.addRecords([
        makeRecord({
          value: 'John Doe',
          policy: 'retrieve_but_redact',
          sensitivity: 'pii_name',
        }),
      ]);

      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('The contact is John Doe');
      expect(result.output).toBe('The contact is [REDACTED]');
      expect(result.modified).toBe(true);
      expect(result.findings[0]?.type).toBe('field_redaction');
    });

    it('redacts role_gated values when user lacks role', () => {
      tracker.addRecords([
        makeRecord({
          value: '150000',
          policy: 'role_gated',
          sensitivity: 'financial',
        }),
      ]);

      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('Salary is 150000');
      expect(result.output).toBe('Salary is [REDACTED]');
    });
  });

  describe('stage 2: pattern scan', () => {
    it('detects and redacts SSN patterns', () => {
      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('SSN: 123-45-6789');
      expect(result.output).toBe('SSN: [REDACTED]');
      expect(result.modified).toBe(true);
      expect(result.blocked).toBe(true); // critical severity
      expect(result.findings[0]?.type).toBe('pattern_match');
      expect(result.findings[0]?.severity).toBe('critical');
    });

    it('detects and redacts credit card patterns', () => {
      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('Card: 4111111111111111');
      expect(result.output).toContain('[REDACTED]');
      expect(result.blocked).toBe(true);
    });
  });

  describe('stage 3: leak detection', () => {
    it('detects leaked pii_identifier as critical', () => {
      tracker.addRecords([
        makeRecord({
          value: 'LEAKED-SSN',
          sensitivity: 'pii_identifier',
          policy: 'never_retrieve',
        }),
      ]);

      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('Found: LEAKED-SSN in the record');
      expect(result.output).toContain('[REDACTED]');
      expect(result.blocked).toBe(true);
      const leakFinding = result.findings.find(
        (f) => f.type === 'leak_detected',
      );
      expect(leakFinding?.severity).toBe('critical');
    });

    it('detects leaked pii_name as warning', () => {
      tracker.addRecords([
        makeRecord({
          value: 'Jane Smith',
          sensitivity: 'pii_name',
          policy: 'never_retrieve',
          entity: 'contact',
        }),
      ]);

      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard(
        'The contact record shows Jane Smith as primary',
      );
      const leakFinding = result.findings.find(
        (f) => f.type === 'leak_detected',
      );
      expect(leakFinding?.severity).toBe('warning');
    });
  });

  describe('stage 4: scope check', () => {
    it('flags unqualified aggregates', () => {
      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
        scopeContext: {
          scopeRules: {
            deal: {type: 'field_match', userContextField: 'owner_id'},
          },
          scopeLabels: {deal: 'by owner'},
        },
      });

      const result = guard.guard('All deals have been processed');
      const scopeFinding = result.findings.find(
        (f) => f.type === 'scope_violation',
      );
      expect(scopeFinding).toBeDefined();
      expect(scopeFinding?.severity).toBe('warning');
      expect(result.blocked).toBe(false); // warnings don't block
    });

    it('does not flag when no scope context', () => {
      const guard = new OutputGuard({
        tracker,
        accessConfigs: new Map(),
        userRoles: [],
      });

      const result = guard.guard('All deals have been processed');
      expect(result.findings).toHaveLength(0);
    });
  });

  it('runs all stages in order', () => {
    tracker.addRecords([
      makeRecord({
        value: 'Jane',
        policy: 'retrieve_but_redact',
        sensitivity: 'pii_name',
      }),
    ]);

    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
      scopeContext: {
        scopeRules: {
          deal: {type: 'field_match', userContextField: 'owner_id'},
        },
        scopeLabels: {},
      },
    });

    const result = guard.guard(
      'Jane said all deals are fine, SSN: 123-45-6789',
    );
    expect(result.output).toContain('[REDACTED]');
    expect(result.modified).toBe(true);
    expect(result.blocked).toBe(true); // SSN pattern is critical
  });

  it('handles empty output', () => {
    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
    });

    const result = guard.guard('');
    expect(result.output).toBe('');
    expect(result.modified).toBe(false);
  });

  it('blocked is true when any finding is critical', () => {
    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
    });

    const result = guard.guard('SSN: 123-45-6789');
    expect(result.blocked).toBe(true);
  });

  it('blocked is false when only warnings', () => {
    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
      scopeContext: {
        scopeRules: {
          deal: {type: 'field_match', userContextField: 'owner_id'},
        },
        scopeLabels: {},
      },
    });

    const result = guard.guard('All deals look good');
    expect(result.blocked).toBe(false);
  });

  it('redacts multiple occurrences of the same value', () => {
    tracker.addRecords([
      makeRecord({
        value: 'John',
        policy: 'retrieve_but_redact',
        sensitivity: 'pii_name',
      }),
    ]);

    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
    });

    const result = guard.guard('John said hi, John is here');
    expect(result.output).toBe('[REDACTED] said hi, [REDACTED] is here');
  });

  it('accumulates findings across all stages', () => {
    tracker.addRecords([
      makeRecord({
        value: 'SECRET',
        policy: 'retrieve_but_redact',
        sensitivity: 'pii_name',
      }),
    ]);

    const guard = new OutputGuard({
      tracker,
      accessConfigs: new Map(),
      userRoles: [],
      scopeContext: {
        scopeRules: {
          deal: {type: 'field_match', userContextField: 'owner_id'},
        },
        scopeLabels: {},
      },
    });

    const result = guard.guard(
      'SECRET found across all deals, SSN: 123-45-6789',
    );
    // Should have findings from field_redaction, pattern_match, and scope_violation
    const types = new Set(result.findings.map((f) => f.type));
    expect(types.has('field_redaction')).toBe(true);
    expect(types.has('pattern_match')).toBe(true);
    expect(types.has('scope_violation')).toBe(true);
  });
});
