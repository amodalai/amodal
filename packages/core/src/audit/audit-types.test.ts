/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  AuditEventTypeSchema,
  AuditSourceSchema,
  AuditEntrySchema,
  AuditConfigSchema,
} from './audit-types.js';

describe('AuditEventTypeSchema', () => {
  it('accepts valid event types', () => {
    expect(AuditEventTypeSchema.parse('tool_call')).toBe('tool_call');
    expect(AuditEventTypeSchema.parse('session_start')).toBe('session_start');
    expect(AuditEventTypeSchema.parse('session_end')).toBe('session_end');
    expect(AuditEventTypeSchema.parse('write_op')).toBe('write_op');
    expect(AuditEventTypeSchema.parse('version_load')).toBe('version_load');
  });

  it('rejects invalid event types', () => {
    expect(() => AuditEventTypeSchema.parse('unknown')).toThrow();
    expect(() => AuditEventTypeSchema.parse('')).toThrow();
  });
});

describe('AuditSourceSchema', () => {
  it('accepts "interactive"', () => {
    expect(AuditSourceSchema.parse('interactive')).toBe('interactive');
  });

  it('accepts automation:<name> pattern', () => {
    expect(AuditSourceSchema.parse('automation:zone_monitor')).toBe(
      'automation:zone_monitor',
    );
    expect(AuditSourceSchema.parse('automation:shift_summary')).toBe(
      'automation:shift_summary',
    );
  });

  it('accepts legacy heartbeat:<name> pattern', () => {
    expect(AuditSourceSchema.parse('heartbeat:zone_monitor')).toBe(
      'heartbeat:zone_monitor',
    );
    expect(AuditSourceSchema.parse('heartbeat:shift_summary')).toBe(
      'heartbeat:shift_summary',
    );
  });

  it('rejects invalid sources', () => {
    expect(() => AuditSourceSchema.parse('batch')).toThrow();
    expect(() => AuditSourceSchema.parse('automation')).toThrow();
    expect(() => AuditSourceSchema.parse('heartbeat')).toThrow();
    expect(() => AuditSourceSchema.parse('')).toThrow();
  });
});

describe('AuditEntrySchema', () => {
  const validEntry = {
    timestamp: '2025-01-01T00:00:00.000Z',
    version: 'v1.0.0',
    session_id: 'sess-123',
    user: 'analyst-1',
    role: 'analyst',
    event: 'tool_call',
    source: 'interactive',
  };

  it('accepts a valid minimal entry', () => {
    const result = AuditEntrySchema.parse(validEntry);
    expect(result.timestamp).toBe('2025-01-01T00:00:00.000Z');
    expect(result.event).toBe('tool_call');
    expect(result.tool).toBeUndefined();
    expect(result.params).toBeUndefined();
    expect(result.duration_ms).toBeUndefined();
  });

  it('accepts a full entry with optional fields', () => {
    const result = AuditEntrySchema.parse({
      ...validEntry,
      tool: 'query_devices',
      params: { zone: 'A1' },
      duration_ms: 150,
    });
    expect(result.tool).toBe('query_devices');
    expect(result.params).toEqual({ zone: 'A1' });
    expect(result.duration_ms).toBe(150);
  });

  it('rejects entry with invalid event type', () => {
    expect(() =>
      AuditEntrySchema.parse({ ...validEntry, event: 'invalid' }),
    ).toThrow();
  });

  it('rejects entry with invalid source', () => {
    expect(() =>
      AuditEntrySchema.parse({ ...validEntry, source: 'batch' }),
    ).toThrow();
  });

  it('rejects entry missing required fields', () => {
    const { session_id: _, ...incomplete } = validEntry;
    expect(() => AuditEntrySchema.parse(incomplete)).toThrow();
  });
});

describe('AuditConfigSchema', () => {
  it('applies defaults for empty object', () => {
    const config = AuditConfigSchema.parse({});
    expect(config.enabled).toBe(true);
    expect(config.outputs).toEqual(['console']);
    expect(config.redactParams).toBe(true);
    expect(config.filePath).toBeUndefined();
    expect(config.remoteUrl).toBeUndefined();
  });

  it('accepts full config with all options', () => {
    const config = AuditConfigSchema.parse({
      enabled: false,
      outputs: ['console', 'file', 'remote'],
      filePath: '/var/log/audit.jsonl',
      remoteUrl: 'https://audit.example.com/ingest',
      redactParams: false,
    });
    expect(config.enabled).toBe(false);
    expect(config.outputs).toEqual(['console', 'file', 'remote']);
    expect(config.filePath).toBe('/var/log/audit.jsonl');
    expect(config.redactParams).toBe(false);
  });

  it('rejects invalid output type', () => {
    expect(() =>
      AuditConfigSchema.parse({ outputs: ['syslog'] }),
    ).toThrow();
  });

  it('rejects invalid remote URL', () => {
    expect(() =>
      AuditConfigSchema.parse({ remoteUrl: 'not-a-url' }),
    ).toThrow();
  });
});
