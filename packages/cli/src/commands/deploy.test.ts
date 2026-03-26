/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const mockFindRepoRoot = vi.fn();
const mockRunValidate = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: (...args: unknown[]) => mockFindRepoRoot(...args),
}));

vi.mock('./validate.js', () => ({
  runValidate: (...args: unknown[]) => mockRunValidate(...args),
}));

const mockPlatformCreate = vi.fn();
vi.mock('../shared/platform-client.js', () => ({
  PlatformClient: {
    create: (...args: unknown[]) => mockPlatformCreate(...args),
  },
}));

// Import after mock
const {runDeploy} = await import('./deploy.js');

describe('deploy command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `amodal-deploy-test-${Date.now()}`);
    mkdirSync(testDir, {recursive: true});
    writeFileSync(
      join(testDir, 'amodal.json'),
      JSON.stringify({
        name: 'my-agent',
        version: '1.0',
        models: {
          main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
        },
      }),
    );

    mockFindRepoRoot.mockReturnValue(testDir);
    mockRunValidate.mockResolvedValue(0); // Validation passes
    mockPlatformCreate.mockResolvedValue({
      uploadSnapshot: vi.fn().mockResolvedValue({id: 'deploy-test123', environment: 'production'}),
    });
  });

  afterEach(() => {
    try {
      rmSync(testDir, {recursive: true, force: true});
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns 1 when repo root not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('No amodal.json found');
    });

    const code = await runDeploy({cwd: testDir});
    expect(code).toBe(1);
  });

  it('dry run succeeds without platform config', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runDeploy({cwd: testDir, dryRun: true});
    expect(code).toBe(0);

    const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Dry run'))).toBe(true);

    stderrSpy.mockRestore();
  });

  it('dry run includes snapshot info in output', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runDeploy({cwd: testDir, dryRun: true, message: 'test deploy'});
    expect(code).toBe(0);

    const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Snapshot deploy-'))).toBe(true);
    expect(messages.some((m) => m.includes('Connections:'))).toBe(true);

    stderrSpy.mockRestore();
  });

  it('returns 1 when platform not configured and not dry-run', async () => {
    mockPlatformCreate.mockRejectedValue(new Error('Platform URL not found. Run `amodal login`.'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const code = await runDeploy({cwd: testDir});
      expect(code).toBe(1);
      const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('Platform'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('uses specified environment', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runDeploy({cwd: testDir, dryRun: true, env: 'staging'});
    expect(code).toBe(0);

    const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('staging'))).toBe(true);

    stderrSpy.mockRestore();
  });
});
