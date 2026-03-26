/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsureNpmContext = vi.fn();
const mockNpmInstall = vi.fn();
const mockNpmInstallAll = vi.fn();
const mockAddLockEntry = vi.fn();
const mockReadLockFile = vi.fn();
const mockEnsureSymlink = vi.fn();
const mockEnsureAllSymlinks = vi.fn();
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
const mockAddConfigDep = vi.fn();
const mockReadConfigDeps = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  npmInstall: mockNpmInstall,
  npmInstallAll: mockNpmInstallAll,
  addLockEntry: mockAddLockEntry,
  readLockFile: mockReadLockFile,
  ensureSymlink: mockEnsureSymlink,
  ensureAllSymlinks: mockEnsureAllSymlinks,
  makePackageRef: mockMakePackageRef,
  parsePackageKey: mockParsePackageKey,
  addConfigDep: mockAddConfigDep,
  readConfigDeps: mockReadConfigDeps,
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
    mockAddLockEntry.mockResolvedValue({lockVersion: 1, packages: {}});
    mockEnsureSymlink.mockResolvedValue('/test/repo/.amodal/packages/connection--test');
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should restore from lock file on bare install', async () => {
    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {'connection/salesforce': {version: '2.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-x'}},
    });

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledWith(mockPaths, '@amodalai/connection-salesforce', '2.0.0');
    expect(mockEnsureSymlink).toHaveBeenCalled();
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
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [{type: 'connection', name: 'stripe'}],
    });
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledWith(mockPaths, '@amodalai/connection-stripe', undefined);
    expect(mockAddLockEntry).toHaveBeenCalledWith('/test/repo', 'connection', 'stripe', {
      version: '1.0.0',
      npm: '@amodalai/connection-stripe',
      integrity: 'sha512-abc',
    });
    expect(mockEnsureSymlink).toHaveBeenCalled();
  });

  it('should install a package with version', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [{type: 'skill', name: 'triage', version: '2.0.0'}],
    });
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledWith(mockPaths, '@amodalai/skill-triage', '2.0.0');
  });

  it('should install multiple packages', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [
        {type: 'connection', name: 'stripe'},
        {type: 'skill', name: 'triage'},
      ],
    });
    expect(result).toBe(0);
    expect(mockNpmInstall).toHaveBeenCalledTimes(2);
    expect(stderrOutput).toContain('2 packages installed successfully');
  });

  it('should continue on error and report failure count', async () => {
    mockNpmInstall
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({version: '1.0.0', integrity: 'sha512-ok'});

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [
        {type: 'connection', name: 'bad'},
        {type: 'skill', name: 'good'},
      ],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to install @amodalai/connection-bad');
    expect(stderrOutput).toContain('1 of 2 packages failed');
  });

  it('should report all failures', async () => {
    mockNpmInstall
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'));

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [
        {type: 'connection', name: 'bad1'},
        {type: 'connection', name: 'bad2'},
      ],
    });
    expect(result).toBe(2);
    expect(stderrOutput).toContain('2 of 2 packages failed');
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
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Nothing to install');
    expect(mockNpmInstallAll).not.toHaveBeenCalled();
  });

  it('should pass cwd to findRepoRoot', async () => {
    mockReadLockFile.mockResolvedValue(null);

    const {runInstallPkg} = await import('./install-pkg.js');
    await runInstallPkg({cwd: '/custom/dir'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should use correct singular form for single package success', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [{type: 'connection', name: 'stripe'}],
    });
    expect(result).toBe(0);
    expect(stderrOutput).toContain('1 package installed successfully');
    expect(stderrOutput).not.toContain('1 packages');
  });

  it('should handle npm install failure for single package', async () => {
    mockNpmInstall.mockRejectedValue(new Error('Registry unreachable'));

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: [{type: 'connection', name: 'fail'}],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Registry unreachable');
  });

  it('should handle empty packages array like bare install', async () => {
    mockReadLockFile.mockResolvedValue(null);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({packages: []});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Nothing to install');
  });

  it('should print version in install progress message', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    await runInstallPkg({
      packages: [{type: 'connection', name: 'stripe', version: '3.2.1'}],
    });
    expect(stderrOutput).toContain('@3.2.1');
  });
});

describe('parseInstallArgs', () => {
  it('parses single type/name pair', async () => {
    const {parseInstallArgs} = await import('./install-pkg.js');
    const result = parseInstallArgs(['connection', 'salesforce']);
    expect(result).toEqual([{type: 'connection', name: 'salesforce'}]);
  });

  it('parses multiple type/name pairs', async () => {
    const {parseInstallArgs} = await import('./install-pkg.js');
    const result = parseInstallArgs(['connection', 'salesforce', 'skill', 'triage']);
    expect(result).toEqual([
      {type: 'connection', name: 'salesforce'},
      {type: 'skill', name: 'triage'},
    ]);
  });

  it('throws on incomplete pair', async () => {
    const {parseInstallArgs} = await import('./install-pkg.js');
    expect(() => parseInstallArgs(['connection'])).toThrow('incomplete pair');
  });

  it('throws on invalid type', async () => {
    const {parseInstallArgs} = await import('./install-pkg.js');
    expect(() => parseInstallArgs(['invalid', 'test'])).toThrow('Invalid package type');
  });

  it('returns empty array for empty input', async () => {
    const {parseInstallArgs} = await import('./install-pkg.js');
    expect(parseInstallArgs([])).toEqual([]);
  });
});
