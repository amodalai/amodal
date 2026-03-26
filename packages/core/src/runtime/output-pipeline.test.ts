/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, vi} from 'vitest';
import {OutputPipeline} from './output-pipeline.js';
import {OutputGuard} from '../security/output-guard.js';
import {ScrubTracker} from '../security/scrub-tracker.js';
import type {GuardResult, ScrubRecord} from '../security/security-types.js';

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

function createGuard(tracker?: ScrubTracker): OutputGuard {
  return new OutputGuard({
    tracker: tracker ?? new ScrubTracker(),
    accessConfigs: new Map(),
    userRoles: [],
  });
}

describe('OutputPipeline', () => {
  let tracker: ScrubTracker;

  beforeEach(() => {
    tracker = new ScrubTracker();
  });

  describe('process', () => {
    it('passes clean output through unmodified', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      const result = pipeline.process('Everything looks normal');
      expect(result.output).toBe('Everything looks normal');
      expect(result.modified).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it('detects and redacts SSN patterns', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      const result = pipeline.process('SSN: 123-45-6789');
      expect(result.output).toBe('SSN: [REDACTED]');
      expect(result.modified).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.findings.some((f) => f.type === 'pattern_match')).toBe(true);
    });

    it('catches tracked scrub values via leak detection', () => {
      tracker.addRecords([
        makeRecord({
          value: 'LEAKED-SECRET',
          sensitivity: 'pii_identifier',
          policy: 'never_retrieve',
        }),
      ]);

      const pipeline = new OutputPipeline({outputGuard: createGuard(tracker)});

      const result = pipeline.process('Found: LEAKED-SECRET in the record');
      expect(result.output).toContain('[REDACTED]');
      expect(result.blocked).toBe(true);
      expect(result.findings.some((f) => f.type === 'leak_detected')).toBe(true);
    });

    it('scope violation produces warning but does not block', () => {
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

      const pipeline = new OutputPipeline({outputGuard: guard});

      const result = pipeline.process('All deals have been processed');
      expect(result.blocked).toBe(false);
      const scopeFinding = result.findings.find((f) => f.type === 'scope_violation');
      expect(scopeFinding).toBeDefined();
      expect(scopeFinding?.severity).toBe('warning');
    });

    it('critical finding blocks output', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      const result = pipeline.process('SSN: 123-45-6789');
      expect(result.blocked).toBe(true);
      const critical = result.findings.find((f) => f.severity === 'critical');
      expect(critical).toBeDefined();
    });

    it('accumulates multiple findings', () => {
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

      const pipeline = new OutputPipeline({outputGuard: guard});

      const result = pipeline.process(
        'SECRET found across all deals, SSN: 123-45-6789',
      );
      const types = new Set(result.findings.map((f) => f.type));
      expect(types.has('field_redaction')).toBe(true);
      expect(types.has('pattern_match')).toBe(true);
      expect(types.has('scope_violation')).toBe(true);
    });

    it('calls onGuardDecision callback with guard result', () => {
      const callback = vi.fn();
      const pipeline = new OutputPipeline({
        outputGuard: createGuard(),
        onGuardDecision: callback,
      });

      pipeline.process('SSN: 123-45-6789');

      expect(callback).toHaveBeenCalledTimes(1);
      const guardResult = callback.mock.calls[0][0] as GuardResult;
      expect(guardResult.blocked).toBe(true);
      expect(guardResult.modified).toBe(true);
      expect(guardResult.findings.length).toBeGreaterThan(0);
    });

    it('does not crash when onGuardDecision is not set', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      expect(() => pipeline.process('Hello')).not.toThrow();
    });

    it('handles empty output', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      const result = pipeline.process('');
      expect(result.output).toBe('');
      expect(result.modified).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it('processes multiple calls independently', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});

      const result1 = pipeline.process('SSN: 123-45-6789');
      const result2 = pipeline.process('Everything is fine');

      expect(result1.blocked).toBe(true);
      expect(result2.blocked).toBe(false);
      expect(result2.output).toBe('Everything is fine');
    });
  });

  describe('StreamGuardProcessor', () => {
    it('buffers tokens correctly', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream = pipeline.createStreamProcessor();

      stream.feed('Hello');
      stream.feed(' ');
      stream.feed('world');

      expect(stream.getBuffer()).toBe('Hello world');
    });

    it('getBuffer returns accumulated text', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream = pipeline.createStreamProcessor();

      expect(stream.getBuffer()).toBe('');
      stream.feed('token1');
      expect(stream.getBuffer()).toBe('token1');
      stream.feed('token2');
      expect(stream.getBuffer()).toBe('token1token2');
    });

    it('finalize guards the buffered text', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream = pipeline.createStreamProcessor();

      stream.feed('SSN: ');
      stream.feed('123-45-6789');

      const result = stream.finalize();
      expect(result.output).toBe('SSN: [REDACTED]');
      expect(result.blocked).toBe(true);
      expect(result.modified).toBe(true);
    });

    it('finalize on clean buffered text passes through', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream = pipeline.createStreamProcessor();

      stream.feed('All clear');

      const result = stream.finalize();
      expect(result.output).toBe('All clear');
      expect(result.blocked).toBe(false);
      expect(result.modified).toBe(false);
    });

    it('finalize calls onGuardDecision', () => {
      const callback = vi.fn();
      const pipeline = new OutputPipeline({
        outputGuard: createGuard(),
        onGuardDecision: callback,
      });
      const stream = pipeline.createStreamProcessor();

      stream.feed('test output');
      stream.finalize();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('finalize on empty buffer handles gracefully', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream = pipeline.createStreamProcessor();

      const result = stream.finalize();
      expect(result.output).toBe('');
      expect(result.modified).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('multiple stream processors from same pipeline are independent', () => {
      const pipeline = new OutputPipeline({outputGuard: createGuard()});
      const stream1 = pipeline.createStreamProcessor();
      const stream2 = pipeline.createStreamProcessor();

      stream1.feed('SSN: 123-45-6789');
      stream2.feed('All clear');

      const result1 = stream1.finalize();
      const result2 = stream2.finalize();

      expect(result1.blocked).toBe(true);
      expect(result2.blocked).toBe(false);
      expect(result2.output).toBe('All clear');
    });
  });
});
