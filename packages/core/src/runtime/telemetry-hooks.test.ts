/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {RuntimeTelemetry} from './telemetry-hooks.js';
import type {RuntimeTelemetryEvent, TelemetrySink} from './telemetry-hooks.js';
import type {ScrubResult, GuardResult, GateResult} from '../security/security-types.js';

describe('RuntimeTelemetry', () => {
  const SESSION_ID = 'session-abc-123';

  function createSink(): TelemetrySink & {calls: RuntimeTelemetryEvent[]} {
    const calls: RuntimeTelemetryEvent[] = [];
    const sink = (event: RuntimeTelemetryEvent): void => {
      calls.push(event);
    };
    sink.calls = calls;
    return sink as TelemetrySink & {calls: RuntimeTelemetryEvent[]};
  }

  describe('logScrub', () => {
    it('sends event with correct type and data', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      const scrubResult: ScrubResult = {
        data: {},
        records: [],
        strippedCount: 3,
        redactableCount: 1,
      };

      telemetry.logScrub(scrubResult, 'crm', '/api/contacts');

      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.type).toBe('field_scrub');
      expect(sink.calls[0]?.data).toEqual({
        connectionName: 'crm',
        endpointPath: '/api/contacts',
        strippedCount: 3,
        redactableCount: 1,
      });
    });
  });

  describe('logGuard', () => {
    it('sends event with findings summary', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      const guardResult: GuardResult = {
        output: 'redacted text',
        modified: true,
        blocked: true,
        findings: [
          {type: 'pattern_match', description: 'SSN found', severity: 'critical'},
          {type: 'scope_violation', description: 'unqualified', severity: 'warning'},
          {type: 'pattern_match', description: 'CC found', severity: 'critical'},
        ],
      };

      telemetry.logGuard(guardResult);

      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.type).toBe('output_guard');
      expect(sink.calls[0]?.data).toEqual({
        modified: true,
        blocked: true,
        findingCount: 3,
        findingTypes: ['pattern_match', 'scope_violation'],
      });
    });
  });

  describe('logGate', () => {
    it('sends event with decision', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      const gateResult: GateResult = {
        decision: 'confirm',
        escalated: false,
        endpointPath: '/api/contacts/123',
      };

      telemetry.logGate(gateResult);

      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.type).toBe('action_gate');
      expect(sink.calls[0]?.data).toEqual({
        decision: 'confirm',
        escalated: false,
        endpointPath: '/api/contacts/123',
      });
    });
  });

  describe('logExplore', () => {
    it('sends event with query and tokens', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      telemetry.logExplore('find all anomalies', 450);

      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.type).toBe('explore_dispatch');
      expect(sink.calls[0]?.data).toEqual({
        query: 'find all anomalies',
        resultTokens: 450,
      });
    });
  });

  describe('logPlanMode', () => {
    it('sends event with action', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      telemetry.logPlanMode('enter');

      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.type).toBe('plan_mode');
      expect(sink.calls[0]?.data).toEqual({action: 'enter'});
    });
  });

  describe('no sink', () => {
    it('does not throw when no sink is provided', () => {
      const telemetry = new RuntimeTelemetry(SESSION_ID);

      expect(() => {
        telemetry.logScrub(
          {data: {}, records: [], strippedCount: 0, redactableCount: 0},
          'crm',
          '/api/test',
        );
        telemetry.logGuard({output: '', modified: false, findings: [], blocked: false});
        telemetry.logGate({decision: 'allow', escalated: false, endpointPath: '/api/test'});
        telemetry.logExplore('query', 100);
        telemetry.logPlanMode('exit');
      }).not.toThrow();
    });
  });

  describe('event metadata', () => {
    it('events have correct sessionId', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry('my-session-42', sink);

      telemetry.logPlanMode('approve');

      expect(sink.calls[0]?.sessionId).toBe('my-session-42');
    });

    it('events have timestamp within reasonable range', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      const before = Date.now();
      telemetry.logExplore('test', 10);
      const after = Date.now();

      const timestamp = sink.calls[0]?.timestamp ?? 0;
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('multiple events sent to same sink', () => {
      const sink = createSink();
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      telemetry.logPlanMode('enter');
      telemetry.logExplore('search', 200);
      telemetry.logPlanMode('exit');

      expect(sink.calls).toHaveLength(3);
      expect(sink.calls[0]?.type).toBe('plan_mode');
      expect(sink.calls[1]?.type).toBe('explore_dispatch');
      expect(sink.calls[2]?.type).toBe('plan_mode');
    });

    it('sink is called synchronously', () => {
      const order: string[] = [];
      const sink: TelemetrySink = () => {
        order.push('sink');
      };
      const telemetry = new RuntimeTelemetry(SESSION_ID, sink);

      order.push('before');
      telemetry.logPlanMode('enter');
      order.push('after');

      expect(order).toEqual(['before', 'sink', 'after']);
    });
  });
});
