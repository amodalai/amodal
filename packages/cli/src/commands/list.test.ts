/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockListLockEntries = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  listLockEntries: mockListLockEntries,
  parsePackageKey: vi.fn((key: string) => {
    const [type, name] = key.split('/');
    return {type, name};
  }),
}));

describe('runList', () => {
  let stdoutOutput: string;
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    stdoutOutput = '';
    stderrOutput = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutOutput += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should print "No packages installed" when no entries', async () => {
    mockListLockEntries.mockResolvedValue([]);

    const {runList} = await import('./list.js');
    const result = await runList();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No packages installed');
  });

  it('should print entries as formatted table', async () => {
    mockListLockEntries.mockResolvedValue([
      {key: 'connection/salesforce', type: 'connection', name: 'salesforce', entry: {version: '2.1.0', npm: '@amodalai/connection-salesforce', integrity: 'sha512-abc'}},
      {key: 'skill/triage', type: 'skill', name: 'triage', entry: {version: '1.0.3', npm: '@amodalai/skill-triage', integrity: 'sha512-def'}},
    ]);

    const {runList} = await import('./list.js');
    const result = await runList();
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('TYPE');
    expect(stdoutOutput).toContain('salesforce');
    expect(stdoutOutput).toContain('triage');
    expect(stderrOutput).toContain('2 packages installed');
  });

  it('should filter by type', async () => {
    mockListLockEntries.mockResolvedValue([]);

    const {runList} = await import('./list.js');
    const result = await runList({type: 'connection'});
    expect(result).toBe(0);
    expect(mockListLockEntries).toHaveBeenCalledWith('/test/repo', 'connection');
    expect(stderrOutput).toContain('No connection packages installed');
  });

  it('should output JSON when json option set', async () => {
    mockListLockEntries.mockResolvedValue([
      {key: 'connection/stripe', type: 'connection', name: 'stripe', entry: {version: '1.0.0', npm: '@amodalai/connection-stripe', integrity: 'sha512-xyz'}},
    ]);

    const {runList} = await import('./list.js');
    const result = await runList({json: true});
    expect(result).toBe(0);

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({type: 'connection', name: 'stripe', version: '1.0.0'});
  });

  it('should return 1 when repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runList} = await import('./list.js');
    const result = await runList();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Not found');
  });

  it('should print "No packages installed" when empty after type filter', async () => {
    mockListLockEntries.mockResolvedValue([]);

    const {runList} = await import('./list.js');
    const result = await runList({type: 'skill'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No skill packages installed');
  });

  it('should handle single package with correct count', async () => {
    mockListLockEntries.mockResolvedValue([
      {key: 'connection/datadog', type: 'connection', name: 'datadog', entry: {version: '3.0.0', npm: '@amodalai/connection-datadog', integrity: 'sha512-ghi'}},
    ]);

    const {runList} = await import('./list.js');
    const result = await runList();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('1 package installed');
    expect(stderrOutput).not.toContain('1 packages');
  });

  it('should pass cwd to findRepoRoot', async () => {
    mockListLockEntries.mockResolvedValue([]);

    const {runList} = await import('./list.js');
    await runList({cwd: '/custom/dir'});
    expect(mockFindRepoRoot).toHaveBeenCalledWith('/custom/dir');
  });

  it('should include integrity in JSON output', async () => {
    mockListLockEntries.mockResolvedValue([
      {key: 'skill/analyze', type: 'skill', name: 'analyze', entry: {version: '1.0.0', npm: '@amodalai/skill-analyze', integrity: 'sha512-integrity-hash'}},
    ]);

    const {runList} = await import('./list.js');
    await runList({json: true});

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed[0]['integrity']).toBe('sha512-integrity-hash');
  });

  it('should handle json output with empty list', async () => {
    mockListLockEntries.mockResolvedValue([]);

    const {runList} = await import('./list.js');
    const result = await runList({json: true});
    expect(result).toBe(0);
    // No JSON output when empty — prints "no packages" to stderr instead
    expect(stderrOutput).toContain('No packages installed');
  });
});
