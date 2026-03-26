/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockLoadRepo = vi.fn();
const mockBuildSyncPlan = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  loadRepo: mockLoadRepo,
  buildSyncPlan: mockBuildSyncPlan,
}));

describe('runSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
  });

  it('should return 0 when all connections are in sync', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {spec: {format: 'openapi', source: 'https://api.test'}}]]),
    });
    mockBuildSyncPlan.mockResolvedValue({
      connectionName: 'api',
      added: [],
      removed: [],
      changed: [],
      unchanged: ['GET /users'],
    });

    const {runSync} = await import('./sync.js');
    const result = await runSync();
    expect(result).toBe(0);
  });

  it('should return 1 in check mode when drift detected', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {spec: {format: 'openapi', source: 'https://api.test'}}]]),
    });
    mockBuildSyncPlan.mockResolvedValue({
      connectionName: 'api',
      added: [{method: 'GET', path: '/new'}],
      removed: [],
      changed: [],
      unchanged: [],
    });

    const {runSync} = await import('./sync.js');
    const result = await runSync({check: true});
    expect(result).toBe(1);
  });

  it('should skip non-openapi connections', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {spec: {format: 'graphql', source: 'https://api.test'}}]]),
    });

    const {runSync} = await import('./sync.js');
    const result = await runSync();
    expect(result).toBe(0);
    expect(mockBuildSyncPlan).not.toHaveBeenCalled();
  });

  it('should filter by connection name', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([
        ['api-1', {spec: {format: 'openapi', source: 'https://api1.test'}}],
        ['api-2', {spec: {format: 'openapi', source: 'https://api2.test'}}],
      ]),
    });
    mockBuildSyncPlan.mockResolvedValue({
      connectionName: 'api-1',
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    });

    const {runSync} = await import('./sync.js');
    await runSync({connection: 'api-1'});
    expect(mockBuildSyncPlan).toHaveBeenCalledTimes(1);
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runSync} = await import('./sync.js');
    const result = await runSync();
    expect(result).toBe(1);
  });

  it('should handle sync errors gracefully', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {spec: {format: 'openapi', source: 'https://api.test'}}]]),
    });
    mockBuildSyncPlan.mockRejectedValue(new Error('Fetch failed'));

    const {runSync} = await import('./sync.js');
    const result = await runSync();
    expect(result).toBe(0);
  });

  it('should return 0 in check mode when no drift', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {spec: {format: 'openapi', source: 'https://api.test'}}]]),
    });
    mockBuildSyncPlan.mockResolvedValue({
      connectionName: 'api',
      added: [],
      removed: [],
      changed: [],
      unchanged: ['GET /users'],
    });

    const {runSync} = await import('./sync.js');
    const result = await runSync({check: true});
    expect(result).toBe(0);
  });
});
