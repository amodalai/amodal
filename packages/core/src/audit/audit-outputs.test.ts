/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  ConsoleAuditOutput,
  FileAuditOutput,
  RemoteAuditOutput,
} from './audit-outputs.js';
import type { AuditEntry } from './audit-types.js';

const makeEntry = (overrides?: Partial<AuditEntry>): AuditEntry => ({
  timestamp: '2025-01-01T00:00:00.000Z',
  version: 'local',
  session_id: 'sess-1',
  user: 'test-user',
  role: 'analyst',
  event: 'tool_call',
  source: 'interactive',
  ...overrides,
});

describe('ConsoleAuditOutput', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes JSON to stderr', () => {
    const output = new ConsoleAuditOutput();
    const entry = makeEntry({ tool: 'query_devices' });
    output.write(entry);
    expect(process.stderr.write).toHaveBeenCalledOnce();
    const mock = process.stderr.write as unknown as { mock: { calls: string[][] } };
    const written = mock.mock.calls[0][0];
    expect(JSON.parse(written.trim())).toEqual(entry);
  });

  it('swallows errors from stderr.write', () => {
    vi.mocked(process.stderr.write).mockImplementation(() => {
      throw new Error('write failed');
    });
    const output = new ConsoleAuditOutput();
    // Should not throw
    expect(() => output.write(makeEntry())).not.toThrow();
  });
});

describe('FileAuditOutput', () => {
  beforeEach(() => {
    vi.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends JSON line to file', () => {
    const output = new FileAuditOutput('/tmp/audit.jsonl');
    const entry = makeEntry({ tool: 'get_device_detail' });
    output.write(entry);
    expect(fs.promises.appendFile).toHaveBeenCalledWith(
      '/tmp/audit.jsonl',
      JSON.stringify(entry) + '\n',
    );
  });

  it('swallows appendFile errors', () => {
    vi.mocked(fs.promises.appendFile).mockRejectedValue(
      new Error('disk full'),
    );
    const output = new FileAuditOutput('/tmp/audit.jsonl');
    // Should not throw
    expect(() => output.write(makeEntry())).not.toThrow();
  });
});

describe('RemoteAuditOutput', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers entries until flush', async () => {
    const output = new RemoteAuditOutput('https://audit.example.com/ingest');
    output.write(makeEntry({ tool: 'tool1' }));
    output.write(makeEntry({ tool: 'tool2' }));
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await output.flush();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as AuditEntry[];
    expect(body).toHaveLength(2);
    expect(body[0].tool).toBe('tool1');
    expect(body[1].tool).toBe('tool2');
  });

  it('does nothing on flush when buffer is empty', async () => {
    const output = new RemoteAuditOutput('https://audit.example.com/ingest');
    await output.flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('auto-flushes at 100 items', () => {
    const output = new RemoteAuditOutput('https://audit.example.com/ingest');
    for (let i = 0; i < 100; i++) {
      output.write(makeEntry({ tool: `tool_${i}` }));
    }
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('swallows fetch errors', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error('network error'),
    );
    const output = new RemoteAuditOutput('https://audit.example.com/ingest');
    output.write(makeEntry());
    // Should not throw
    await expect(output.flush()).resolves.toBeUndefined();
  });
});
