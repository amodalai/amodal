/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockLoadRepo = vi.fn();
const mockReadLockFile = vi.fn();
const mockResolveAllPackages = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  loadRepo: mockLoadRepo,
  readLockFile: mockReadLockFile,
  resolveAllPackages: mockResolveAllPackages,
}));

describe('runValidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
  });

  it('should return 0 when repo is valid', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {
        surface: [{method: 'GET', path: '/test'}],
        access: {},
      }]]),
      skills: [{name: 'test', body: 'content'}],
      automations: [{name: 'daily', schedule: '0 8 * * *'}],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(0);
  });

  it('should warn when no connections exist', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(0); // warnings don't cause failure
  });

  it('should warn when connection has no surface endpoints', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {surface: [], access: {}}]]),
      skills: [],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(0);
  });

  it('should error when skill has empty body', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'empty-skill', body: ''}],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(1);
  });

  it('should warn when automation has no schedule', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [{name: 'webhook-only'}],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(0);
  });

  it('should return 1 when repo load fails', async () => {
    mockLoadRepo.mockRejectedValue(new Error('Config parse failed'));

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(1);
  });

  it('should return 1 when repo root not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(1);
  });

  it('should handle multiple skill errors', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [
        {name: 'skill-1', body: ''},
        {name: 'skill-2', body: ''},
      ],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(2);
  });

  it('should report both errors and warnings', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'bad', body: ''}],
      automations: [{name: 'no-schedule'}],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(1); // 1 error
  });

  // Package-aware validation tests
  it('should run package validation when packages flag set', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {surface: [{method: 'GET', path: '/test'}], access: {}}]]),
      skills: [{name: 'test', body: 'content'}],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(0);
    expect(mockResolveAllPackages).toHaveBeenCalled();
  });

  it('should report resolution warnings as validation warnings', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {'connection/salesforce': {version: '1.0.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-x'}}});
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: ['Package connection/salesforce is in lock file but not installed (broken symlink?)'],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(0); // warnings only
  });

  it('should error on empty resolved skill', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'bad-skill', body: '  '}],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(1);
  });

  it('should skip package validation when no lock file', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {surface: [{method: 'GET', path: '/test'}], access: {}}]]),
      skills: [],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue(null);

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(0);
    expect(mockResolveAllPackages).not.toHaveBeenCalled();
  });

  it('should not run package checks without packages flag', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {surface: [{method: 'GET', path: '/test'}], access: {}}]]),
      skills: [],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate();
    expect(result).toBe(0);
    expect(mockReadLockFile).not.toHaveBeenCalled();
  });

  it('should handle package resolution failure', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});
    mockResolveAllPackages.mockRejectedValue(new Error('Disk error'));

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(1);
  });

  it('should warn on resolved connection with no endpoints', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });
    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map([['empty-conn', {surface: [], spec: {auth: null}}]]),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({packages: true});
    expect(result).toBe(0); // warning only
  });
});
