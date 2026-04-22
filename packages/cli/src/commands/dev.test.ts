/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock runtime dependencies that we don't need for the DATABASE_URL check
vi.mock('@amodalai/runtime', () => ({
  createLocalServer: vi.fn().mockResolvedValue({
    app: {},
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
  initLogLevel: vi.fn(),
  interceptConsole: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@amodalai/db', () => ({
  getDb: vi.fn(),
  ensureSchema: vi.fn().mockResolvedValue(undefined),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@amodalai/core', () => ({
  ensureAdminAgent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../shared/connection-preflight.js', () => ({
  runConnectionPreflight: vi.fn().mockResolvedValue({results: [], hasFailures: false}),
  printPreflightTable: vi.fn(),
}));

/**
 * Smoke test: `amodal dev` without DATABASE_URL should print instructions
 * and exit with code 1.
 */
describe('dev command', () => {
  let tmpDir: string;
  let fakeHome: string;
  let origHome: string;
  let origDatabaseUrl: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'dev-test-'));
    fakeHome = mkdtempSync(path.join(os.tmpdir(), 'dev-test-home-'));

    // Create a minimal amodal.json so findRepoRoot succeeds
    writeFileSync(path.join(tmpDir, 'amodal.json'), JSON.stringify({name: 'test-agent'}));

    origHome = process.env['HOME'] ?? '';
    origDatabaseUrl = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    process.env['HOME'] = fakeHome;
  });

  afterEach(() => {
    process.env['HOME'] = origHome;
    if (origDatabaseUrl !== undefined) {
      process.env['DATABASE_URL'] = origDatabaseUrl;
    } else {
      delete process.env['DATABASE_URL'];
    }
    rmSync(tmpDir, {recursive: true, force: true});
    rmSync(fakeHome, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  it('exits with code 1 and prints instructions when DATABASE_URL is missing', async () => {
    // Capture stderr output
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    // Mock process.exit to throw so we can catch it
    vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
      throw new ExitError(typeof code === 'number' ? code : 1);
    });

    const {runDev} = await import('./dev.js');

    try {
      await runDev({cwd: tmpDir});
      expect.unreachable('runDev should have called process.exit');
    } catch (err: unknown) {
      if (err instanceof ExitError) {
        expect(err.code).toBe(1);
      } else {
        throw err;
      }
    }

    const output = stderrChunks.join('');
    expect(output).toContain('DATABASE_URL is required');
    expect(output).toContain('docker run');
    expect(output).toContain('~/.amodal/.env');
  });

  it('should import without error', async () => {
    const mod = await import('./dev.js');
    expect(mod.runDev).toBeDefined();
    expect(typeof mod.runDev).toBe('function');
  });
});

/** Sentinel error thrown by our process.exit mock. */
class ExitError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${String(code)})`);
    this.name = 'ExitError';
    this.code = code;
  }
}
