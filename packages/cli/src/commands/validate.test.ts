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

const mockMcpManager = {
  startServers: vi.fn().mockResolvedValue(undefined),
  getServerInfo: vi.fn().mockReturnValue([]),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@amodalai/core', () => ({
  loadRepo: mockLoadRepo,
  readLockFile: mockReadLockFile,
  resolveAllPackages: mockResolveAllPackages,
  McpManager: vi.fn(() => mockMcpManager),
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
    const result = await runValidate({skipTest: true});
    expect(result).toBe(0);
  });

  it('should warn when no connections exist', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
    expect(result).toBe(0); // warnings don't cause failure
  });

  it('should warn when connection has no surface endpoints', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map([['api', {surface: [], access: {}}]]),
      skills: [],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
    expect(result).toBe(0);
  });

  it('should error when skill has empty body', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'empty-skill', body: ''}],
      automations: [],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
    expect(result).toBe(1);
  });

  it('should warn when automation has no schedule', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [{name: 'webhook-only'}],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
    expect(result).toBe(0);
  });

  it('should return 1 when repo load fails', async () => {
    mockLoadRepo.mockRejectedValue(new Error('Config parse failed'));

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
    expect(result).toBe(1);
  });

  it('should return 1 when repo root not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
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
    const result = await runValidate({skipTest: true});
    expect(result).toBe(2);
  });

  it('should report both errors and warnings', async () => {
    mockLoadRepo.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'bad', body: ''}],
      automations: [{name: 'no-schedule'}],
    });

    const {runValidate} = await import('./validate.js');
    const result = await runValidate({skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
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
    const result = await runValidate({skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
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
    const result = await runValidate({packages: true, skipTest: true});
    expect(result).toBe(0); // warning only
  });

  // Live connection testing
  describe('live connection tests', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockReset();
    });

    it('should test REST connections and report pass on 200', async () => {
      mockLoadRepo.mockResolvedValue({
        connections: new Map([['myapi', {
          surface: [{method: 'GET', path: '/test'}],
          access: {},
          spec: {baseUrl: 'https://api.example.com', auth: {type: 'none'}},
        }]]),
        skills: [],
        automations: [],
      });
      mockFetch.mockResolvedValue({status: 200, redirected: false});

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({method: 'GET'}),
      );
    });

    it('should report fail on 401', async () => {
      mockLoadRepo.mockResolvedValue({
        connections: new Map([['myapi', {
          surface: [{method: 'GET', path: '/test'}],
          access: {},
          spec: {baseUrl: 'https://api.example.com', auth: {type: 'bearer', token: 'env:BAD_KEY'}},
        }]]),
        skills: [],
        automations: [],
      });
      mockFetch.mockResolvedValue({status: 401, redirected: false});

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(1);
    });

    it('should use testPath when available', async () => {
      mockLoadRepo.mockResolvedValue({
        connections: new Map([['myapi', {
          surface: [{method: 'GET', path: '/me'}],
          access: {},
          spec: {baseUrl: 'https://api.example.com/v2', testPath: '/me', auth: {type: 'none'}},
        }]]),
        skills: [],
        automations: [],
      });
      mockFetch.mockResolvedValue({status: 200, redirected: false});

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v2/me',
        expect.objectContaining({method: 'GET'}),
      );
    });

    it('should report network errors as fail', async () => {
      mockLoadRepo.mockResolvedValue({
        connections: new Map([['myapi', {
          surface: [{method: 'GET', path: '/test'}],
          access: {},
          spec: {baseUrl: 'https://unreachable.example.com', auth: {type: 'none'}},
        }]]),
        skills: [],
        automations: [],
      });
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(1);
    });

    it('should test MCP servers and report pass on connected', async () => {
      mockMcpManager.getServerInfo.mockReturnValue([
        {name: 'xpoz', status: 'connected', tools: ['search', 'get'], error: undefined},
      ]);

      mockLoadRepo.mockResolvedValue({
        connections: new Map(),
        skills: [],
        automations: [],
        mcpServers: {xpoz: {transport: 'http', url: 'https://mcp.xpoz.ai/mcp'}},
      });

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(0);
      expect(mockMcpManager.startServers).toHaveBeenCalled();
      expect(mockMcpManager.shutdown).toHaveBeenCalled();
    });

    it('should report MCP server failure', async () => {
      mockMcpManager.getServerInfo.mockReturnValue([
        {name: 'broken', status: 'error', tools: [], error: 'Connection refused'},
      ]);

      mockLoadRepo.mockResolvedValue({
        connections: new Map(),
        skills: [],
        automations: [],
        mcpServers: {broken: {transport: 'http', url: 'https://broken.example.com/mcp'}},
      });

      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(1);
    });

    it('should handle redirect + retry for auth stripping', async () => {
      mockLoadRepo.mockResolvedValue({
        connections: new Map([['myapi', {
          surface: [{method: 'GET', path: '/test'}],
          access: {},
          spec: {baseUrl: 'https://api.example.com/v2', auth: {type: 'bearer', token: 'env:MY_TOKEN'}},
        }]]),
        skills: [],
        automations: [],
      });
      // First call: redirected, lost auth → 401
      // Second call: retry with auth → 200
      mockFetch
        .mockResolvedValueOnce({status: 401, redirected: true, url: 'https://api.example.com/v2/'})
        .mockResolvedValueOnce({status: 200, redirected: false});

      process.env['MY_TOKEN'] = 'test-token';
      const {runValidate} = await import('./validate.js');
      const result = await runValidate({skipTest: false});
      expect(result).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      delete process.env['MY_TOKEN'];
    });
  });
});
