/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsureNpmContext = vi.fn();
const mockReadLockFile = vi.fn();
const mockNpmViewVersions = vi.fn();
const mockNpmInstall = vi.fn();
const mockFromNpmName = vi.fn((npm: string) => npm.replace('@amodalai/', ''));
const mockDiscoverInstalledPackages = vi.fn();
const mockBuildLockFile = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  readLockFile: mockReadLockFile,
  npmViewVersions: mockNpmViewVersions,
  npmInstall: mockNpmInstall,
  fromNpmName: mockFromNpmName,
  discoverInstalledPackages: mockDiscoverInstalledPackages,
  buildLockFile: mockBuildLockFile,
}));

vi.mock('semver', () => ({
  maxSatisfying: vi.fn((versions: string[], range: string) => {
    // Simple mock: return the last version for '*', first matching for '^'
    if (range === '*') return versions[versions.length - 1];
    // For ^x.y.z, return last version with same major
    const major = range.replace('^', '').split('.')[0];
    const matching = versions.filter((v) => v.startsWith(major + '.'));
    return matching.length > 0 ? matching[matching.length - 1] : null;
  }),
}));

const mockPaths = {
  root: '/test/repo/.amodal/packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

describe('runUpdate', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockEnsureNpmContext.mockResolvedValue(mockPaths);
    mockNpmInstall.mockResolvedValue({version: '2.0.0', integrity: 'sha512-new'});
    mockDiscoverInstalledPackages.mockResolvedValue([]);
    mockBuildLockFile.mockResolvedValue(undefined);
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should update all packages', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0', '1.2.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalled();
    expect(stderrOutput).toContain('Updated');
  });

  it('should update single package by name', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
        '@amodalai/skill-triage': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({name: 'connection-salesforce'});
    expect(result).toBe(0);
    expect(mockNpmViewVersions).toHaveBeenCalledTimes(1);
  });

  it('should report already up to date', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.2.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0', '1.2.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('up to date');
    expect(mockNpmInstall).not.toHaveBeenCalled();
  });

  it('should show dry run output', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({dryRun: true});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Dry run');
    expect(stderrOutput).toContain('1.1.0');
    expect(mockNpmInstall).not.toHaveBeenCalled();
  });

  it('should use latest flag for cross-major updates', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0', '2.0.0', '3.0.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({latest: true});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('3.0.0');
  });

  it('should return 1 when no lock file', async () => {
    mockReadLockFile.mockResolvedValue(null);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('No lock file');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should handle registry unreachable', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockRejectedValue(new Error('Registry unreachable'));

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to check');
  });

  it('should continue on partial failure', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
        '@amodalai/skill-triage': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions
      .mockResolvedValueOnce(['1.0.0', '1.1.0'])
      .mockResolvedValueOnce(['1.0.0', '1.1.0']);
    mockNpmInstall
      .mockRejectedValueOnce(new Error('Install failed'))
      .mockResolvedValueOnce({version: '1.1.0', integrity: 'sha512-new'});

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('1 of 2');
  });

  it('should handle empty lock file', async () => {
    mockReadLockFile.mockResolvedValue({lockVersion: 2, packages: {}});

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No packages installed');
  });

  it('should report no matching packages', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({name: 'nonexistent'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No matching packages');
  });

  it('should rebuild lock file after update', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    await runUpdate();
    expect(mockDiscoverInstalledPackages).toHaveBeenCalledWith(mockPaths);
    expect(mockBuildLockFile).toHaveBeenCalled();
  });

  it('should use singular form for 1 package', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {version: '1.0.0', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    await runUpdate();
    expect(stderrOutput).toContain('1 package updated');
    expect(stderrOutput).not.toContain('1 packages');
  });
});
