/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsureNpmContext = vi.fn();
const mockNpmInstall = vi.fn();
const mockReadLockFile = vi.fn();
const mockReadConfigDeps = vi.fn();
const mockToNpmName = vi.fn((name: string) => `@amodalai/${name}`);
const mockAddConfigDep = vi.fn();
const mockDiscoverInstalledPackages = vi.fn();
const mockBuildLockFile = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  npmInstall: mockNpmInstall,
  readLockFile: mockReadLockFile,
  readConfigDeps: mockReadConfigDeps,
  toNpmName: mockToNpmName,
  addConfigDep: mockAddConfigDep,
  discoverInstalledPackages: mockDiscoverInstalledPackages,
  buildLockFile: mockBuildLockFile,
}));

const mockPaths = {
  root: '/test/repo/.amodal/packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

describe('runInstallPkg', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockEnsureNpmContext.mockResolvedValue(mockPaths);
    mockNpmInstall.mockResolvedValue({version: '1.0.0', integrity: 'sha512-abc'});
    mockDiscoverInstalledPackages.mockResolvedValue([]);
    mockBuildLockFile.mockResolvedValue(undefined);
    mockAddConfigDep.mockResolvedValue(undefined);
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should restore from lock file on bare install', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {'@amodalai/connection-salesforce': {version: '2.0.0', integrity: 'sha512-x'}},
    });

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledWith(mockPaths, '@amodalai/connection-salesforce', '2.0.0');
    expect(stderrOutput).toContain('Restoring 1 package');
  });

  it('should print nothing to install when no lock file and no deps on bare install', async () => {
    mockReadLockFile.mockResolvedValue(null);
    mockReadConfigDeps.mockResolvedValue({});

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Nothing to install');
  });

  it('should install a single package', async () => {
    mockDiscoverInstalledPackages.mockResolvedValue([
      {npmName: '@amodalai/alert-enrichment', version: '1.0.0', integrity: 'sha512-abc'},
    ]);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['alert-enrichment'],
    });
    expect(result).toBe(0);
    expect(mockToNpmName).toHaveBeenCalledWith('alert-enrichment');
    expect(mockNpmInstall).toHaveBeenCalledWith(mockPaths, '@amodalai/alert-enrichment');
    expect(mockDiscoverInstalledPackages).toHaveBeenCalledWith(mockPaths);
    expect(mockBuildLockFile).toHaveBeenCalledWith('/test/repo', expect.any(Array));
  });

  it('should install multiple packages', async () => {
    mockDiscoverInstalledPackages.mockResolvedValue([
      {npmName: '@amodalai/connection-stripe', version: '1.0.0', integrity: 'sha512-abc'},
      {npmName: '@amodalai/soc-agent', version: '1.0.0', integrity: 'sha512-def'},
    ]);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['connection-stripe', 'soc-agent'],
    });
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledTimes(2);
  });

  it('should continue on error and report failure count', async () => {
    mockNpmInstall
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({version: '1.0.0', integrity: 'sha512-ok'});
    mockDiscoverInstalledPackages.mockResolvedValue([
      {npmName: '@amodalai/good', version: '1.0.0', integrity: 'sha512-ok'},
    ]);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['bad', 'good'],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed');
    expect(stderrOutput).toContain('failed');
  });

  it('should report all failures', async () => {
    mockNpmInstall
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'));
    mockDiscoverInstalledPackages.mockResolvedValue([]);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['bad1', 'bad2'],
    });
    expect(result).toBe(2);
    expect(stderrOutput).toContain('failed');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should handle bare install with empty lock file packages', async () => {
    mockReadLockFile.mockResolvedValue({lockVersion: 2, packages: {}});

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Nothing to install');
  });

  it('should pass cwd to findRepoRoot', async () => {
    mockReadLockFile.mockResolvedValue(null);
    mockReadConfigDeps.mockResolvedValue({});

    const {runInstallPkg} = await import('./install-pkg.js');
    await runInstallPkg({cwd: '/custom/dir'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should handle npm install failure for single package', async () => {
    mockNpmInstall.mockRejectedValue(new Error('Registry unreachable'));
    mockDiscoverInstalledPackages.mockResolvedValue([]);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['fail'],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Registry unreachable');
  });

  it('should handle empty packages array like bare install', async () => {
    mockReadLockFile.mockResolvedValue(null);
    mockReadConfigDeps.mockResolvedValue({});

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({packages: []});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Nothing to install');
  });
});
