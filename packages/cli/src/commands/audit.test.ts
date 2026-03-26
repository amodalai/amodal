/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

describe('runAudit', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('outputs JSON format', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'sess-1',
        events: [
          {id: 'e1', eventType: 'tool_call', data: {}, tokenCount: 10, durationMs: 50, createdAt: '2026-03-15T10:00:00Z'},
        ],
      }),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runAudit} = await import('./audit.js');
    await runAudit({
      sessionId: 'sess-1',
      format: 'json',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('"sessionId"');
    stdoutSpy.mockRestore();
  });

  it('outputs table format by default', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'sess-1',
        events: [
          {id: 'e1', eventType: 'tool_call', data: {}, tokenCount: null, durationMs: 50, createdAt: '2026-03-15T10:00:00Z'},
          {id: 'e2', eventType: 'session_end', data: {}, tokenCount: null, durationMs: null, createdAt: '2026-03-15T10:01:00Z'},
        ],
      }),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runAudit} = await import('./audit.js');
    await runAudit({
      sessionId: 'sess-1',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('tool_call');
    expect(output).toContain('session_end');
    expect(output).toContain('Total: 2 events');
    stdoutSpy.mockRestore();
  });

  it('handles empty events', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({sessionId: 'sess-1', events: []}),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runAudit} = await import('./audit.js');
    await runAudit({
      sessionId: 'sess-1',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('No audit events found');
    stdoutSpy.mockRestore();
  });
});
