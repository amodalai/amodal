/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockToNpmName = vi.fn((name: string) => `@amodalai/${name}`);
const mockPmRemove = vi.fn();
const mockRemoveAmodalPackage = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  toNpmName: mockToNpmName,
  pmRemove: mockPmRemove,
  removeAmodalPackage: mockRemoveAmodalPackage,
}));

describe('runUninstall', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockPmRemove.mockResolvedValue(undefined);
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
    expect(mockPmRemove).toHaveBeenCalledWith('/test/repo', '@amodalai/connection-stripe');
    expect(mockRemoveAmodalPackage).toHaveBeenCalledWith('/test/repo', '@amodalai/connection-stripe');
    expect(stderrOutput).toContain('Removed @amodalai/connection-stripe');
  });

  it('should return 1 when pm remove fails', async () => {
    mockPmRemove.mockRejectedValue(new Error('npm error'));

    const {runUninstall} = await import('./uninstall.js');
    const result = await runUninstall({name: 'skill-triage'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to remove');
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
});
