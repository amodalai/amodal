/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as childProcess from 'node:child_process';

import type {NpmContextPaths} from './npm-context.js';
import {npmView, npmSearch, npmViewVersions} from './npm-registry.js';
import {PackageError} from './package-error.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockPaths: NpmContextPaths = {
  root: '/test/repo/amodal_packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

// Helper to make execFile behave like its promisified version
function mockExecFileResult(stdout: string): void {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: {stdout: string; stderr: string}) => void) => {
      if (typeof cb === 'function') {
        cb(null, {stdout, stderr: ''});
      }
      return {};
    },
  );
}

function mockExecFileError(message: string): void {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      if (typeof cb === 'function') {
        cb(new Error(message));
      }
      return {};
    },
  );
}

describe('npmView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse npm view output', async () => {
    mockExecFileResult(JSON.stringify({
      name: '@amodalai/connection-salesforce',
      version: '2.1.0',
      versions: ['1.0.0', '2.0.0', '2.1.0'],
      description: 'Salesforce connection',
    }));

    const result = await npmView(mockPaths, '@amodalai/connection-salesforce');
    expect(result.name).toBe('@amodalai/connection-salesforce');
    expect(result.version).toBe('2.1.0');
    expect(result.versions).toEqual(['1.0.0', '2.0.0', '2.1.0']);
    expect(result.description).toBe('Salesforce connection');
  });

  it('should throw PackageError on parse failure', async () => {
    mockExecFileResult('not json');

    await expect(npmView(mockPaths, '@amodalai/connection-salesforce'))
      .rejects.toThrow(PackageError);
  });

  it('should throw PackageError when npm fails', async () => {
    mockExecFileError('npm ERR! 404 Not Found');

    await expect(npmView(mockPaths, '@amodalai/connection-nonexistent'))
      .rejects.toThrow(PackageError);
  });

  it('should handle missing description', async () => {
    mockExecFileResult(JSON.stringify({
      name: '@amodalai/skill-triage',
      version: '1.0.0',
      versions: ['1.0.0'],
    }));

    const result = await npmView(mockPaths, '@amodalai/skill-triage');
    expect(result.description).toBeUndefined();
  });
});

describe('npmSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse npm search results', async () => {
    mockExecFileResult(JSON.stringify([
      {name: '@amodalai/connection-salesforce', version: '2.1.0', description: 'Salesforce'},
      {name: '@amodalai/connection-stripe', version: '1.0.0', description: 'Stripe'},
    ]));

    const results = await npmSearch(mockPaths, '@amodalai/connection');
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('@amodalai/connection-salesforce');
    expect(results[1].name).toBe('@amodalai/connection-stripe');
  });

  it('should return empty array for no results', async () => {
    mockExecFileResult('[]');

    const results = await npmSearch(mockPaths, 'nonexistent');
    expect(results).toHaveLength(0);
  });

  it('should throw PackageError on failure', async () => {
    mockExecFileError('Registry unreachable');

    await expect(npmSearch(mockPaths, 'test'))
      .rejects.toThrow(PackageError);
  });
});

describe('npmViewVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse versions array', async () => {
    mockExecFileResult(JSON.stringify(['1.0.0', '1.1.0', '2.0.0']));

    const versions = await npmViewVersions(mockPaths, '@amodalai/connection-salesforce');
    expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0']);
  });

  it('should handle single version string', async () => {
    mockExecFileResult('"1.0.0"');

    const versions = await npmViewVersions(mockPaths, '@amodalai/connection-new');
    expect(versions).toEqual(['1.0.0']);
  });

  it('should throw PackageError on failure', async () => {
    mockExecFileError('404 Not Found');

    await expect(npmViewVersions(mockPaths, '@amodalai/connection-nonexistent'))
      .rejects.toThrow(PackageError);
  });
});
