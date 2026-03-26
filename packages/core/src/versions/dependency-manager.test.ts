/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  diffDependencies,
  installNpmDependencies,
  installPipDependencies,
  verifySystemBinaries,
  installDependencies,
} from './dependency-manager.js';
import type { BundleDependencies } from './version-bundle-types.js';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Helper to make execFile succeed
function mockExecFileSuccess(): void {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof cb === 'function') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
      } else if (typeof _opts === 'function') {
        (_opts as (err: null, stdout: string, stderr: string) => void)(null, '', '');
      }
      return {} as ReturnType<typeof execFile>;
    },
  );
}

// Helper to make execFile fail
function mockExecFileFail(): void {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      const err = new Error('not found');
      if (typeof cb === 'function') {
        (cb as (err: Error) => void)(err);
      } else if (typeof _opts === 'function') {
        (_opts as (err: Error) => void)(err);
      }
      return {} as ReturnType<typeof execFile>;
    },
  );
}

describe('diffDependencies', () => {
  it('detects added npm packages', () => {
    const oldDeps: BundleDependencies = {};
    const newDeps: BundleDependencies = {
      npm: { lodash: '4.17.21', axios: '1.6.0' },
    };
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.npm.added).toEqual({ lodash: '4.17.21', axios: '1.6.0' });
    expect(diff.npm.removed).toEqual([]);
    expect(diff.npm.changed).toEqual({});
  });

  it('detects removed npm packages', () => {
    const oldDeps: BundleDependencies = {
      npm: { lodash: '4.17.21' },
    };
    const newDeps: BundleDependencies = {};
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.npm.removed).toEqual(['lodash']);
    expect(diff.npm.added).toEqual({});
  });

  it('detects changed npm package versions', () => {
    const oldDeps: BundleDependencies = { npm: { lodash: '4.17.20' } };
    const newDeps: BundleDependencies = { npm: { lodash: '4.17.21' } };
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.npm.changed).toEqual({ lodash: '4.17.21' });
    expect(diff.npm.added).toEqual({});
    expect(diff.npm.removed).toEqual([]);
  });

  it('detects pip changes', () => {
    const oldDeps: BundleDependencies = { pip: { numpy: '1.24.0' } };
    const newDeps: BundleDependencies = {
      pip: { numpy: '1.25.0', pandas: '2.0.0' },
    };
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.pip.changed).toEqual({ numpy: '1.25.0' });
    expect(diff.pip.added).toEqual({ pandas: '2.0.0' });
  });

  it('detects system binary changes', () => {
    const oldDeps: BundleDependencies = { system: ['ffmpeg'] };
    const newDeps: BundleDependencies = { system: ['ffmpeg', 'ffprobe'] };
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.system.added).toEqual(['ffprobe']);
    expect(diff.system.removed).toEqual([]);
  });

  it('handles empty deps on both sides', () => {
    const diff = diffDependencies({}, {});
    expect(diff.npm.added).toEqual({});
    expect(diff.npm.removed).toEqual([]);
    expect(diff.npm.changed).toEqual({});
    expect(diff.pip.added).toEqual({});
    expect(diff.system.added).toEqual([]);
  });

  it('handles removed system binaries', () => {
    const oldDeps: BundleDependencies = { system: ['git', 'ffmpeg'] };
    const newDeps: BundleDependencies = { system: ['git'] };
    const diff = diffDependencies(oldDeps, newDeps);
    expect(diff.system.removed).toEqual(['ffmpeg']);
  });
});

describe('installNpmDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
  });

  it('writes package.json and runs pnpm install', async () => {
    await installNpmDependencies(
      { lodash: '4.17.21' },
      '/tmp/v1',
    );
    expect(mkdir).toHaveBeenCalledWith('/tmp/v1', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      expect.stringContaining('lodash'),
    );
    expect(execFile).toHaveBeenCalledWith(
      'pnpm',
      ['install', '--prod'],
      expect.objectContaining({ cwd: '/tmp/v1' }),
      expect.any(Function),
    );
  });

  it('skips when deps are empty', async () => {
    await installNpmDependencies({}, '/tmp/v1');
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('installPipDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
  });

  it('runs pip install with correct args', async () => {
    await installPipDependencies(
      { numpy: '1.24.0' },
      '/tmp/v1',
    );
    expect(execFile).toHaveBeenCalledWith(
      'pip',
      expect.arrayContaining(['install', '--target', expect.stringContaining('python_modules'), 'numpy==1.24.0']),
      expect.objectContaining({ cwd: '/tmp/v1' }),
      expect.any(Function),
    );
  });

  it('skips when deps are empty', async () => {
    await installPipDependencies({}, '/tmp/v1');
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('verifySystemBinaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty missing list when all binaries exist', async () => {
    mockExecFileSuccess();
    const result = await verifySystemBinaries(['git', 'node']);
    expect(result.missing).toEqual([]);
  });

  it('returns missing binaries', async () => {
    mockExecFileFail();
    const result = await verifySystemBinaries(['nonexistent']);
    expect(result.missing).toEqual(['nonexistent']);
  });

  it('returns empty missing list for empty input', async () => {
    const result = await verifySystemBinaries([]);
    expect(result.missing).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('installDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
  });

  it('installs npm and pip deps and verifies system binaries', async () => {
    const diff = diffDependencies(
      {},
      { npm: { lodash: '4.17.21' }, pip: { numpy: '1.24.0' }, system: ['git'] },
    );
    const result = await installDependencies(diff, '/tmp/v1');
    expect(result.npmInstalled).toBe(true);
    expect(result.pipInstalled).toBe(true);
    expect(result.missingBinaries).toEqual([]);
  });

  it('reports when nothing was installed', async () => {
    const diff = diffDependencies({}, {});
    const result = await installDependencies(diff, '/tmp/v1');
    expect(result.npmInstalled).toBe(false);
    expect(result.pipInstalled).toBe(false);
    expect(result.missingBinaries).toEqual([]);
  });
});
