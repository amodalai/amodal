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
const mockAddLockEntry = vi.fn();
const mockEnsureSymlink = vi.fn();
const mockMakePackageRef = vi.fn((type: string, name: string) => ({
  type,
  name,
  key: `${type}/${name}`,
  npmName: `@amodalai/${type}-${name}`,
}));
const mockParsePackageKey = vi.fn((key: string) => {
  const [type, name] = key.split('/');
  return {type, name};
});

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  readLockFile: mockReadLockFile,
  npmViewVersions: mockNpmViewVersions,
  npmInstall: mockNpmInstall,
  addLockEntry: mockAddLockEntry,
  ensureSymlink: mockEnsureSymlink,
  makePackageRef: mockMakePackageRef,
  parsePackageKey: mockParsePackageKey,
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
    mockAddLockEntry.mockResolvedValue({lockVersion: 1, packages: {}});
    mockEnsureSymlink.mockResolvedValue('/test/repo/.amodal/packages/connection--salesforce');
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should update all packages', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0', '1.2.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalled();
    expect(stderrOutput).toContain('Updated');
  });

  it('should update single package by type and name', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
        'skill/triage': {version: '1.0.0', npm: '@amodalai/skill-triage', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({type: 'connection', name: 'salesforce'});
    expect(result).toBe(0);
    expect(mockNpmViewVersions).toHaveBeenCalledTimes(1);
  });

  it('should report already up to date', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.2.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
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
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
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
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
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
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
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
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
        'skill/triage': {version: '1.0.0', npm: '@amodalai/skill-triage', integrity: 'sha512-old'},
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
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No packages installed');
  });

  it('should filter by type only', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
        'skill/triage': {version: '1.0.0', npm: '@amodalai/skill-triage', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    await runUpdate({type: 'skill'});
    expect(mockNpmViewVersions).toHaveBeenCalledTimes(1);
  });

  it('should report no matching packages', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
      },
    });

    const {runUpdate} = await import('./update.js');
    const result = await runUpdate({type: 'skill', name: 'nonexistent'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No matching packages');
  });

  it('should update lock entry and symlink', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    await runUpdate();
    expect(mockAddLockEntry).toHaveBeenCalled();
    expect(mockEnsureSymlink).toHaveBeenCalled();
  });

  it('should use singular form for 1 package', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {
        'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-old'},
      },
    });
    mockNpmViewVersions.mockResolvedValue(['1.0.0', '1.1.0']);

    const {runUpdate} = await import('./update.js');
    await runUpdate();
    expect(stderrOutput).toContain('1 package updated');
    expect(stderrOutput).not.toContain('1 packages');
  });
});
