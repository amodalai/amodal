/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockGetLockEntry = vi.fn();
const mockGetNpmContextPaths = vi.fn();
const mockMakePackageRef = vi.fn((type: string, name: string) => ({
  type,
  name,
  key: `${type}/${name}`,
  npmName: `@amodalai/${type}-${name}`,
}));
const mockNpmUninstall = vi.fn();
const mockRemoveLockEntry = vi.fn();
const mockToSymlinkName = vi.fn((type: string, name: string) => `${type}--${name}`);

const mockUnlink = vi.fn();
const mockStat = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  getLockEntry: mockGetLockEntry,
  getNpmContextPaths: mockGetNpmContextPaths,
  makePackageRef: mockMakePackageRef,
  npmUninstall: mockNpmUninstall,
  removeLockEntry: mockRemoveLockEntry,
  toSymlinkName: mockToSymlinkName,
}));

vi.mock('node:fs/promises', () => ({
  unlink: mockUnlink,
  stat: mockStat,
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
    mockGetLockEntry.mockResolvedValue({version: '1.0.0', npm: '@amodalai/connection-stripe', integrity: 'sha512-abc'});
    mockNpmUninstall.mockResolvedValue(undefined);
    mockRemoveLockEntry.mockResolvedValue({lockVersion: 1, packages: {}});
    mockUnlink.mockResolvedValue(undefined);
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should uninstall a package successfully', async () => {
    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(0);
    expect(mockNpmUninstall).toHaveBeenCalledWith(mockPaths, '@amodalai/connection-stripe');
    expect(mockRemoveLockEntry).toHaveBeenCalledWith('/test/repo', 'connection', 'stripe');
    expect(mockUnlink).toHaveBeenCalled();
    expect(stderrOutput).toContain('Removed connection/stripe');
  });

  it('should return 1 when package not in lock file', async () => {
    mockGetLockEntry.mockResolvedValue(null);

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'unknown'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('not installed');
    expect(mockNpmUninstall).not.toHaveBeenCalled();
  });

  it('should handle symlink already gone (ENOENT)', async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Removed connection/stripe');
  });

  it('should return 1 when npm uninstall fails', async () => {
    mockNpmUninstall.mockRejectedValue(new Error('npm error'));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'skill', name: 'triage'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('npm uninstall failed');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should print note when override directory exists', async () => {
    mockStat.mockResolvedValue({isDirectory: () => true});

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('local override directory still exists');
  });

  it('should pass cwd to findRepoRoot', async () => {
    const {runUninstall} = await import('./uninstall.js');
    await runUninstall({cwd: '/custom/dir', type: 'connection', name: 'test'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should warn but succeed when symlink removal fails with non-ENOENT error', async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error('EPERM'), {code: 'EPERM'}));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('could not remove symlink');
  });

  it('should use correct override dir path with plural type', async () => {
    mockStat.mockResolvedValue({isDirectory: () => true});

    const {runUninstall} = await import('./uninstall.js');
    await runUninstall({type: 'skill', name: 'triage'});
    // Override dir: skills/triage
    expect(mockStat).toHaveBeenCalledWith(
      expect.stringContaining('skills/triage'),
    );
  });

  it('should handle no override dir without error', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({type: 'connection', name: 'stripe'});
    expect(result).toBe(0);
    expect(stderrOutput).not.toContain('override');
  });
});
