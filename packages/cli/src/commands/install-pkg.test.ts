/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsurePackageJson = vi.fn();
const mockPmAdd = vi.fn();
const mockPmInstall = vi.fn();
const mockAddAmodalPackage = vi.fn();
const mockToNpmName = vi.fn((name: string) => `@amodalai/${name}`);

const mockReadFileSync = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensurePackageJson: mockEnsurePackageJson,
  pmAdd: mockPmAdd,
  pmInstall: mockPmInstall,
  addAmodalPackage: mockAddAmodalPackage,
  toNpmName: mockToNpmName,
}));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

describe('runInstallPkg', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockPmAdd.mockResolvedValue(undefined);
    mockPmInstall.mockResolvedValue(undefined);
    mockReadFileSync.mockReturnValue(JSON.stringify({name: 'test-project'}));
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should run pmInstall on bare install', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(mockEnsurePackageJson).toHaveBeenCalledWith('/test/repo', 'test-project');
    expect(mockPmInstall).toHaveBeenCalledWith('/test/repo');
    expect(stderrOutput).toContain('Done');
  });

  it('should handle pmInstall failure on bare install', async () => {
    mockPmInstall.mockRejectedValue(new Error('Install failed'));

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Install failed');
  });

  it('should install a single package', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['alert-enrichment'],
    });
    expect(result).toBe(0);
    expect(mockToNpmName).toHaveBeenCalledWith('alert-enrichment');
    expect(mockPmAdd).toHaveBeenCalledWith('/test/repo', '@amodalai/alert-enrichment');
    expect(mockAddAmodalPackage).toHaveBeenCalledWith('/test/repo', '@amodalai/alert-enrichment');
  });

  it('should install multiple packages', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['connection-stripe', 'soc-agent'],
    });
    expect(result).toBe(0);
    expect(mockPmAdd).toHaveBeenCalledTimes(2);
  });

  it('should continue on error and report failure count', async () => {
    mockPmAdd
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['bad', 'good'],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed');
    expect(stderrOutput).toContain('failed');
  });

  it('should report all failures', async () => {
    mockPmAdd
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'));

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

  it('should use default project name when amodal.json is missing', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg();
    expect(result).toBe(0);
    expect(mockEnsurePackageJson).toHaveBeenCalledWith('/test/repo', 'amodal-project');
  });

  it('should pass cwd to findRepoRoot', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    await runInstallPkg({cwd: '/custom/dir'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should handle npm add failure for single package', async () => {
    mockPmAdd.mockRejectedValue(new Error('Registry unreachable'));

    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({
      packages: ['fail'],
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Registry unreachable');
  });

  it('should handle empty packages array like bare install', async () => {
    const {runInstallPkg} = await import('./install-pkg.js');
    const result = await runInstallPkg({packages: []});
    expect(result).toBe(0);
    expect(mockPmInstall).toHaveBeenCalledWith('/test/repo');
  });
});
