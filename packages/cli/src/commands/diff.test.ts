/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsureNpmContext = vi.fn();
const mockGetLockEntry = vi.fn();
const mockNpmView = vi.fn();
const mockGetNpmContextPaths = vi.fn();
const mockReadPackageFile = vi.fn();
const mockListPackageFiles = vi.fn();
const mockToNpmName = vi.fn((name: string) => `@amodalai/${name}`);
const mockFromNpmName = vi.fn((npm: string) => npm.replace('@amodalai/', ''));

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  getLockEntry: mockGetLockEntry,
  npmView: mockNpmView,
  getNpmContextPaths: mockGetNpmContextPaths,
  readPackageFile: mockReadPackageFile,
  listPackageFiles: mockListPackageFiles,
  toNpmName: mockToNpmName,
  fromNpmName: mockFromNpmName,
}));

const mockPaths = {
  root: '/test/repo/.amodal/packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

describe('runDiff', () => {
  let stderrOutput: string;
  let stdoutOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockEnsureNpmContext.mockResolvedValue(mockPaths);
    mockGetNpmContextPaths.mockReturnValue(mockPaths);
    stderrOutput = '';
    stdoutOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutOutput += String(chunk);
      return true;
    });
  });

  it('should show diff when version differs', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});
    mockListPackageFiles.mockResolvedValue(['spec.json', 'surface.md', 'package.json']);
    mockReadPackageFile.mockResolvedValue('content\nline2\n');

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('1.0.0');
    expect(stdoutOutput).toContain('2.0.0');
  });

  it('should report already latest', async () => {
    mockGetLockEntry.mockResolvedValue({version: '2.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('already the latest');
  });

  it('should return 1 when not installed', async () => {
    mockGetLockEntry.mockResolvedValue(null);

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('not installed');
  });

  it('should return 1 when registry unreachable', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockRejectedValue(new Error('Registry unreachable'));

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to query registry');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should show surface endpoint count', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});
    mockListPackageFiles.mockResolvedValue(['surface.md']);
    mockReadPackageFile.mockResolvedValue('## GET /users\nList users\n\n## POST /users\nCreate user\n');

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('2 endpoints');
  });

  it('should show spec.json keys', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});
    mockListPackageFiles.mockResolvedValue(['spec.json']);
    mockReadPackageFile.mockResolvedValue(JSON.stringify({baseUrl: 'https://api.example.com', specUrl: 'https://api.example.com/spec', format: 'openapi'}));

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('specUrl');
    expect(stdoutOutput).toContain('format');
  });

  it('should show access.json rule count', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});
    mockListPackageFiles.mockResolvedValue(['access.json']);
    mockReadPackageFile.mockResolvedValue(JSON.stringify({
      'GET /users': {confirm: true},
      'POST /users': {confirm: 'review'},
    }));

    const {runDiff} = await import('./diff.js');
    const result = await runDiff({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('2 rules');
  });

  it('should suggest update command', async () => {
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', integrity: 'sha512-old'});
    mockNpmView.mockResolvedValue({name: '@amodalai/connection-salesforce', version: '2.0.0', versions: ['1.0.0', '2.0.0']});
    mockListPackageFiles.mockResolvedValue([]);

    const {runDiff} = await import('./diff.js');
    await runDiff({name: 'connection-salesforce'});
    expect(stdoutOutput).toContain('amodal update connection-salesforce');
  });
});
