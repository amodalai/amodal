/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockGetNpmContextPaths = vi.fn();
const mockToNpmName = vi.fn((name: string) => `@amodalai/${name}`);
const mockNpmUninstall = vi.fn();
const mockEnsureNpmContext = vi.fn();
const mockDiscoverInstalledPackages = vi.fn();
const mockBuildLockFile = vi.fn();

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  getNpmContextPaths: mockGetNpmContextPaths,
  toNpmName: mockToNpmName,
  npmUninstall: mockNpmUninstall,
  ensureNpmContext: mockEnsureNpmContext,
  discoverInstalledPackages: mockDiscoverInstalledPackages,
  buildLockFile: mockBuildLockFile,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

const mockPaths = {
  root: '/test/repo/.amodal/packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

describe('runUninstall', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockGetNpmContextPaths.mockReturnValue(mockPaths);
    mockNpmUninstall.mockResolvedValue(undefined);
    mockEnsureNpmContext.mockResolvedValue(mockPaths);
    mockDiscoverInstalledPackages.mockResolvedValue([]);
    mockBuildLockFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error('ENOENT')); // amodal.json not found by default
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should uninstall a package successfully', async () => {
    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({name: 'connection-stripe'});
    expect(result).toBe(0);
    expect(mockNpmUninstall).toHaveBeenCalledWith(mockPaths, '@amodalai/connection-stripe');
    expect(mockDiscoverInstalledPackages).toHaveBeenCalledWith(mockPaths);
    expect(mockBuildLockFile).toHaveBeenCalledWith('/test/repo', []);
    expect(stderrOutput).toContain('Removed @amodalai/connection-stripe');
  });

  it('should return 1 when npm uninstall fails', async () => {
    mockNpmUninstall.mockRejectedValue(new Error('npm error'));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({name: 'skill-triage'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('npm uninstall failed');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({name: 'connection-stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should pass cwd to findRepoRoot', async () => {
    const {runUninstall} = await import('./uninstall.js');
    await runUninstall({cwd: '/custom/dir', name: 'connection-test'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should remove dependency from amodal.json when it exists', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: 'test',
      dependencies: {'@amodalai/connection-stripe': '1.0.0', '@amodalai/soc-agent': '2.0.0'},
    }));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({name: 'connection-stripe'});
    expect(result).toBe(0);
    expect(mockWriteFile).toHaveBeenCalled();
  });
});
