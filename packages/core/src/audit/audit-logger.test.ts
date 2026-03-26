/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from './audit-logger.js';
import { Kind } from '@google/gemini-cli-core';
import type { AuditConfig, AuditContext, AuditEntry } from './audit-types.js';

function makeConfig(overrides?: Partial<AuditConfig>): AuditConfig {
  return {
    enabled: true,
    outputs: ['console'],
    redactParams: true,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<AuditContext>): AuditContext {
  return {
    version: 'local',
    sessionId: 'sess-1',
    user: 'test-user',
    role: 'analyst',
    source: 'interactive',
    ...overrides,
  };
}

function parseStderrEntries(): AuditEntry[] {
  const mock = process.stderr.write as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.map(
    (call) => JSON.parse((call[0] as string).trim()) as AuditEntry,
  );
}

describe('AuditLogger', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits tool_call events with correct fields', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logToolCall('query_devices', { zone: 'A1' }, 150);
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('tool_call');
    expect(entries[0].tool).toBe('query_devices');
    expect(entries[0].duration_ms).toBe(150);
    expect(entries[0].session_id).toBe('sess-1');
    expect(entries[0].user).toBe('test-user');
    expect(entries[0].role).toBe('analyst');
    expect(entries[0].source).toBe('interactive');
    expect(entries[0].version).toBe('local');
    expect(entries[0].timestamp).toBeDefined();
  });

  it('emits write_op events', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logWriteOp('write_file', { path: '/tmp/test.txt' });
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('write_op');
    expect(entries[0].tool).toBe('write_file');
  });

  it('emits session_start events', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logSessionStart();
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('session_start');
    expect(entries[0].tool).toBeUndefined();
  });

  it('emits session_end events', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logSessionEnd();
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('session_end');
  });

  it('emits version_load events', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logVersionLoad('v2.1.0');
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('version_load');
    expect(entries[0].params).toEqual({ version: 'v2.1.0' });
  });

  it('emits kb_proposal events', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logKbProposal('application', 'Rogue sensor patterns', 'prop-001');
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('kb_proposal');
    expect(entries[0].params).toEqual({
      scope: 'application',
      title: 'Rogue sensor patterns',
      proposal_id: 'prop-001',
    });
  });

  it('emits kb_proposal events without proposal_id', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logKbProposal('tenant', 'Zone C incident');
    const entries = parseStderrEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('kb_proposal');
    expect(entries[0].params).toEqual({
      scope: 'tenant',
      title: 'Zone C incident',
      proposal_id: undefined,
    });
  });

  it('redacts sensitive params by default', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logToolCall('http_tool', {
      url: 'https://api.example.com',
      api_key: 'sk-secret-123',
    });
    const entries = parseStderrEntries();

    expect(entries[0].params).toEqual({
      url: 'https://api.example.com',
      api_key: '[REDACTED]',
    });
  });

  it('does not redact when redactParams is false', () => {
    const logger = new AuditLogger(
      makeConfig({ redactParams: false }),
      makeContext(),
    );
    logger.logToolCall('http_tool', { api_key: 'sk-secret-123' });
    const entries = parseStderrEntries();

    expect(entries[0].params).toEqual({ api_key: 'sk-secret-123' });
  });

  it('does not emit when disabled', () => {
    const logger = new AuditLogger(
      makeConfig({ enabled: false }),
      makeContext(),
    );
    logger.logToolCall('query_devices', { zone: 'A1' });
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('uses context from construction', () => {
    const logger = new AuditLogger(
      makeConfig(),
      makeContext({
        version: 'v3.0.0',
        sessionId: 'sess-999',
        user: 'supervisor-1',
        role: 'supervisor',
        source: 'automation:zone_monitor',
      }),
    );
    logger.logToolCall('get_anomalies');
    const entries = parseStderrEntries();

    expect(entries[0].version).toBe('v3.0.0');
    expect(entries[0].session_id).toBe('sess-999');
    expect(entries[0].user).toBe('supervisor-1');
    expect(entries[0].role).toBe('supervisor');
    expect(entries[0].source).toBe('automation:zone_monitor');
  });

  it('handles logToolCall without params', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logToolCall('ls');
    const entries = parseStderrEntries();

    expect(entries[0].event).toBe('tool_call');
    expect(entries[0].tool).toBe('ls');
    expect(entries[0].params).toBeUndefined();
  });

  it('handles logToolCall without duration', () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    logger.logToolCall('ls', { path: '/' });
    const entries = parseStderrEntries();

    expect(entries[0].duration_ms).toBeUndefined();
  });

  it('flush resolves cleanly', async () => {
    const logger = new AuditLogger(makeConfig(), makeContext());
    // ConsoleAuditOutput doesn't have flush, so this should resolve cleanly
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});

describe('AuditLogger.isWriteOperation', () => {
  it('returns true for Edit kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Edit)).toBe(true);
  });

  it('returns true for Delete kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Delete)).toBe(true);
  });

  it('returns true for Move kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Move)).toBe(true);
  });

  it('returns true for Execute kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Execute)).toBe(true);
  });

  it('returns false for Read kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Read)).toBe(false);
  });

  it('returns false for Search kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Search)).toBe(false);
  });

  it('returns false for Fetch kind', () => {
    expect(AuditLogger.isWriteOperation(Kind.Fetch)).toBe(false);
  });
});
