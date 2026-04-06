/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsurePackageJson = vi.fn();
const mockPmAdd = vi.fn();
const mockReadPackageManifest = vi.fn();
const mockToNpmName = vi.fn((name: string) => `@amodalai/connection-${name}`);
const mockFindMissingEnvVars = vi.fn();
const mockUpsertEnvEntries = vi.fn();

const mockPromptForCredentials = vi.fn();
const mockTestConnection = vi.fn();
const mockRunOAuth2Flow = vi.fn();

const mockPrompts = vi.fn();

const mockStatSync = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensurePackageJson: mockEnsurePackageJson,
  pmAdd: mockPmAdd,
  readPackageManifest: mockReadPackageManifest,
  toNpmName: mockToNpmName,
  findMissingEnvVars: mockFindMissingEnvVars,
  upsertEnvEntries: mockUpsertEnvEntries,
}));

vi.mock('../auth/index.js', () => ({
  promptForCredentials: mockPromptForCredentials,
  testConnection: mockTestConnection,
  runOAuth2Flow: mockRunOAuth2Flow,
}));

vi.mock('prompts', () => ({
  default: mockPrompts,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: mockStatSync,
  };
});

const bearerManifest = {
  name: 'stripe',
  auth: {
    type: 'bearer' as const,
    envVars: {STRIPE_API_KEY: 'Your Stripe API key'},
  },
  testEndpoints: ['https://api.stripe.com/v1/charges?limit=1'],
};

const apiKeyManifest = {
  name: 'datadog',
  auth: {
    type: 'api_key' as const,
    headers: {'DD-API-KEY': '${DD_API_KEY}'},
    envVars: {DD_API_KEY: 'Datadog API key'},
  },
  testEndpoints: ['https://api.datadoghq.com/api/v1/validate'],
};

const oauth2Manifest = {
  name: 'salesforce',
  auth: {
    type: 'oauth2' as const,
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['api', 'refresh_token'],
    envVars: {SF_ACCESS_TOKEN: 'Access token', SF_REFRESH_TOKEN: 'Refresh token'},
  },
  testEndpoints: ['https://my.salesforce.com/services/data/v58.0/query?q=SELECT+Id+FROM+Account+LIMIT+1'],
};

const noAuthManifest = {
  name: 'public-api',
  testEndpoints: ['https://api.example.com/health'],
};

describe('runConnect', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    // By default, package is NOT installed (statSync throws)
    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockPmAdd.mockResolvedValue(undefined);
    mockFindMissingEnvVars.mockResolvedValue([]);
    mockUpsertEnvEntries.mockResolvedValue(undefined);
    mockPromptForCredentials.mockResolvedValue({credentials: {}, summary: 'Set 1 credential'});
    mockTestConnection.mockResolvedValue({connectionName: 'test', results: [], allPassed: true});
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should install + auth (bearer) + test on fresh connect', async () => {
    mockReadPackageManifest.mockResolvedValue(bearerManifest);
    mockTestConnection.mockResolvedValue({
      connectionName: 'stripe',
      results: [{url: 'https://api.stripe.com/v1/charges?limit=1', status: 'ok', statusCode: 200, durationMs: 50}],
      allPassed: true,
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(mockPmAdd).toHaveBeenCalled();
    expect(mockPromptForCredentials).toHaveBeenCalled();
    expect(mockTestConnection).toHaveBeenCalled();
    expect(stderrOutput).toContain('Connected: stripe');
  });

  it('should install + auth (api_key) + test on fresh connect', async () => {
    mockReadPackageManifest.mockResolvedValue(apiKeyManifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'datadog'});
    expect(result).toBe(0);
    expect(mockPmAdd).toHaveBeenCalled();
    expect(mockPromptForCredentials).toHaveBeenCalled();
  });

  it('should install + oauth2 flow on fresh connect', async () => {
    mockReadPackageManifest.mockResolvedValue(oauth2Manifest);
    mockPrompts
      .mockResolvedValueOnce({clientId: 'my-client-id'})
      .mockResolvedValueOnce({clientSecret: 'my-secret'});
    mockRunOAuth2Flow.mockResolvedValue({
      credentials: {SF_ACCESS_TOKEN: 'tok', SF_REFRESH_TOKEN: 'ref'},
      summary: 'OAuth2 authorization complete. 2 tokens obtained',
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'salesforce'});
    expect(result).toBe(0);
    expect(mockRunOAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'my-client-id',
      clientSecret: 'my-secret',
    }));
    expect(mockUpsertEnvEntries).toHaveBeenCalled();
  });

  it('should handle no auth manifest', async () => {
    mockReadPackageManifest.mockResolvedValue(noAuthManifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'public-api'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No authentication required');
    expect(mockPromptForCredentials).not.toHaveBeenCalled();
  });

  it('should skip install on reconnect', async () => {
    // Package already installed in node_modules
    mockStatSync.mockReturnValue({isDirectory: () => true});
    mockReadPackageManifest.mockResolvedValue(bearerManifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(mockPmAdd).not.toHaveBeenCalled();
    expect(stderrOutput).toContain('already installed');
  });

  it('should skip credential prompt on reconnect when vars present', async () => {
    mockStatSync.mockReturnValue({isDirectory: () => true});
    mockReadPackageManifest.mockResolvedValue(bearerManifest);
    mockFindMissingEnvVars.mockResolvedValue([]);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Credentials already configured');
  });

  it('should re-prompt on reconnect with force', async () => {
    mockStatSync.mockReturnValue({isDirectory: () => true});
    mockReadPackageManifest.mockResolvedValue(bearerManifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe', force: true});
    expect(result).toBe(0);
    expect(mockPromptForCredentials).toHaveBeenCalled();
  });

  it('should return 1 when test fails', async () => {
    mockReadPackageManifest.mockResolvedValue(bearerManifest);
    mockTestConnection.mockResolvedValue({
      connectionName: 'stripe',
      results: [{url: 'https://api.stripe.com/v1/charges', status: 'error', error: 'HTTP 401', durationMs: 30}],
      allPassed: false,
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Connection test failed');
  });

  it('should skip test when no test endpoints', async () => {
    const manifest = {...bearerManifest, testEndpoints: undefined};
    mockReadPackageManifest.mockResolvedValue(manifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(stderrOutput).toContain('No test endpoints');
  });

  it('should return 1 when npm install fails', async () => {
    mockPmAdd.mockRejectedValue(new Error('Registry down'));

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Install failed');
  });

  it('should return 1 when manifest read fails', async () => {
    mockReadPackageManifest.mockRejectedValue(new Error('No manifest'));

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to read package manifest');
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should return 1 when user cancels oauth2 auth (clientId)', async () => {
    mockReadPackageManifest.mockResolvedValue(oauth2Manifest);
    mockPrompts.mockResolvedValueOnce({}); // undefined clientId = cancelled

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'salesforce'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Auth cancelled');
  });

  it('should return 1 when user cancels bearer auth', async () => {
    mockReadPackageManifest.mockResolvedValue(bearerManifest);
    mockPromptForCredentials.mockResolvedValue({
      credentials: {},
      summary: 'Cancelled. 0 of 1 credentials collected',
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Auth cancelled');
  });

  it('should prompt for missing vars on reconnect without force', async () => {
    mockStatSync.mockReturnValue({isDirectory: () => true});
    mockReadPackageManifest.mockResolvedValue(bearerManifest);
    mockFindMissingEnvVars.mockResolvedValue(['STRIPE_API_KEY']);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(mockPromptForCredentials).toHaveBeenCalled();
  });

  it('should skip test when testEndpoints is empty array', async () => {
    const manifest = {...bearerManifest, testEndpoints: []};
    mockReadPackageManifest.mockResolvedValue(manifest);

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'stripe'});
    expect(result).toBe(0);
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it('should handle oauth2 with empty client secret', async () => {
    mockReadPackageManifest.mockResolvedValue(oauth2Manifest);
    mockPrompts
      .mockResolvedValueOnce({clientId: 'my-client'})
      .mockResolvedValueOnce({clientSecret: ''});
    mockRunOAuth2Flow.mockResolvedValue({
      credentials: {SF_ACCESS_TOKEN: 'tok'},
      summary: 'OAuth2 complete',
    });

    const {runConnect} = await import('./connect.js');
    const result = await runConnect({name: 'salesforce'});
    expect(result).toBe(0);
    expect(mockRunOAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({
      clientSecret: undefined,
    }));
  });
});
