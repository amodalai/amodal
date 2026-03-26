/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockReadPackageManifest = vi.fn();
const mockStat = vi.fn();
const mockReadFile = vi.fn();
const mockExecFile = vi.fn();

vi.mock('@amodalai/core', () => ({
  readPackageManifest: mockReadPackageManifest,
}));

vi.mock('node:fs/promises', () => ({
  stat: mockStat,
  readFile: mockReadFile,
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

describe('runPublish', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({isFile: () => true});
    mockReadPackageManifest.mockResolvedValue({
      type: 'connection',
      name: 'salesforce',
    });
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/connection-salesforce',
      version: '1.0.0',
      amodal: {type: 'connection', name: 'salesforce'},
    }));
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  it('should publish successfully', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: {stdout: string; stderr: string}) => void) => {
        cb(null, {stdout: '', stderr: ''});
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Published');
  });

  it('should show dry run output', async () => {
    const {runPublish} = await import('./publish.js');
    const result = await runPublish({dryRun: true});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Dry run');
    expect(stderrOutput).toContain('connection');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should return 1 when package.json missing', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('No package.json');
  });

  it('should return 1 when manifest invalid', async () => {
    mockReadPackageManifest.mockRejectedValue(new Error('Missing amodal block'));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Invalid package');
  });

  it('should return 1 when required files missing', async () => {
    // First stat succeeds (package.json), second fails (spec.json)
    mockStat
      .mockResolvedValueOnce({isFile: () => true})
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Missing required files');
  });

  it('should handle npm publish failure', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('Network error'));
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Publish failed');
  });

  it('should handle already published (409)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('EPUBLISHCONFLICT'));
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('already exists');
  });

  it('should suggest npm login on auth error (ENEEDAUTH)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('ENEEDAUTH'));
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('npm login');
  });

  it('should suggest npm login on auth error (E401)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('E401'));
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('npm login');
  });

  it('should use custom registry', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, result: {stdout: string; stderr: string}) => void) => {
        expect(args).toContain('https://custom.registry.com');
        cb(null, {stdout: '', stderr: ''});
        return {};
      },
    );

    const {runPublish} = await import('./publish.js');
    const result = await runPublish({registry: 'https://custom.registry.com'});
    expect(result).toBe(0);
  });

  it('should validate skill package required files', async () => {
    mockReadPackageManifest.mockResolvedValue({type: 'skill', name: 'triage'});
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/skill-triage',
      version: '1.0.0',
      amodal: {type: 'skill', name: 'triage'},
    }));

    // package.json exists, SKILL.md missing
    mockStat
      .mockResolvedValueOnce({isFile: () => true})
      .mockRejectedValueOnce(new Error('ENOENT'));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('SKILL.md');
  });

  it('should show package name and version in dry run', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/connection-stripe',
      version: '3.2.1',
      amodal: {type: 'connection', name: 'stripe'},
    }));

    const {runPublish} = await import('./publish.js');
    await runPublish({dryRun: true});
    expect(stderrOutput).toContain('@amodalai/connection-stripe@3.2.1');
  });
});
