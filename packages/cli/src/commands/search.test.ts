/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockEnsureNpmContext = vi.fn();
const mockNpmSearch = vi.fn();
const mockFromNpmName = vi.fn((npm: string) => {
  const prefix = '@amodalai/';
  if (!npm.startsWith(prefix)) throw new Error('Not amodal');
  const rest = npm.slice(prefix.length);
  const dash = rest.indexOf('-');
  if (dash < 0) throw new Error('No type');
  return {type: rest.slice(0, dash), name: rest.slice(dash + 1)};
});

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  ensureNpmContext: mockEnsureNpmContext,
  npmSearch: mockNpmSearch,
  fromNpmName: mockFromNpmName,
}));

const mockPaths = {
  root: '/test/repo/.amodal/packages',
  npmDir: '/test/repo/.amodal/packages/.npm',
  npmrc: '/test/repo/.amodal/packages/.npm/.npmrc',
  packageJson: '/test/repo/.amodal/packages/.npm/package.json',
  nodeModules: '/test/repo/.amodal/packages/.npm/node_modules',
};

describe('runSearch', () => {
  let stderrOutput: string;
  let stdoutOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    mockEnsureNpmContext.mockResolvedValue(mockPaths);
    stderrOutput = '';
    stdoutOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutOutput += String(chunk);
      return true;
    });
  });

  it('should search and display results', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '2.1.0', description: 'Salesforce'},
      {name: '@amodalai/connection-stripe', version: '1.0.0', description: 'Stripe'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({query: 'salesforce'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('salesforce');
    expect(stdoutOutput).toContain('stripe');
  });

  it('should filter by type', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '2.1.0', description: 'Salesforce'},
      {name: '@amodalai/skill-triage', version: '1.0.0', description: 'Triage'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({type: 'connection'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('salesforce');
    expect(stdoutOutput).not.toContain('triage');
  });

  it('should output JSON when json flag set', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '2.1.0', description: 'Salesforce'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({json: true});
    expect(result).toBe(0);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('connection');
  });

  it('should handle no results', async () => {
    mockNpmSearch.mockResolvedValue([]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({query: 'nonexistent'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No packages found');
  });

  it('should handle registry unreachable', async () => {
    mockNpmSearch.mockRejectedValue(new Error('Registry unreachable'));

    const {runSearch} = await import('./search.js');
    const result = await runSearch({query: 'test'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Search failed');
  });

  it('should filter out non-amodal packages', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '1.0.0', description: 'Salesforce'},
      {name: 'lodash', version: '4.0.0', description: 'Utility'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('salesforce');
    expect(stdoutOutput).not.toContain('lodash');
  });

  it('should work without repo root', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/skill-triage', version: '1.0.0', description: 'Triage'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({query: 'triage'});
    expect(result).toBe(0);
  });

  it('should group results by type', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '2.0.0', description: 'Salesforce'},
      {name: '@amodalai/skill-triage', version: '1.0.0', description: 'Triage'},
    ]);

    const {runSearch} = await import('./search.js');
    const result = await runSearch({});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('CONNECTION');
    expect(stdoutOutput).toContain('SKILL');
  });

  it('should handle npm context failure', async () => {
    mockEnsureNpmContext.mockRejectedValue(new Error('Permission denied'));

    const {runSearch} = await import('./search.js');
    const result = await runSearch({});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to set up npm context');
  });

  it('should show package count', async () => {
    mockNpmSearch.mockResolvedValue([
      {name: '@amodalai/connection-salesforce', version: '1.0.0', description: 'Salesforce'},
      {name: '@amodalai/connection-stripe', version: '1.0.0', description: 'Stripe'},
    ]);

    const {runSearch} = await import('./search.js');
    await runSearch({});
    expect(stderrOutput).toContain('2 packages found');
  });
});
