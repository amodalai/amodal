/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';

// Mock process.exit to not actually exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const stderrWrites: string[] = [];
vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
  stderrWrites.push(String(s));
  return true;
});

const testDir = join(tmpdir(), `build-test-${randomBytes(4).toString('hex')}`);

beforeEach(() => {
  stderrWrites.length = 0;
  mockExit.mockClear();
});

afterEach(() => {
  rmSync(testDir, {recursive: true, force: true});
});

describe('runBuild', () => {
  it('returns 1 when no amodal.json found', async () => {
    mkdirSync(testDir, {recursive: true});

    const {runBuild} = await import('./build.js');
    const code = await runBuild({cwd: testDir});
    expect(code).toBe(1);
    expect(stderrWrites.some((s) => s.includes('amodal.json'))).toBe(true);
  });

  it('builds a snapshot and writes resolved-config.json', async () => {
    mkdirSync(testDir, {recursive: true});
    writeFileSync(join(testDir, 'amodal.json'), JSON.stringify({
      name: 'test-agent',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    }));

    const {runBuild} = await import('./build.js');
    const outputPath = join(testDir, 'output.json');
    const code = await runBuild({cwd: testDir, output: outputPath});

    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(snapshot.deployId).toMatch(/^deploy-[0-9a-f]{7}$/);
    expect(snapshot.config.name).toBe('test-agent');
    expect(snapshot.source).toBe('cli');
    expect(stderrWrites.some((s) => s.includes('Snapshot'))).toBe(true);
  });
});
