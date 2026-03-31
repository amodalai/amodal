/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

const mockStat = vi.fn();
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();
const mockExecFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  stat: mockStat,
  readFile: mockReadFile,
  readdir: mockReaddir,
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

const validPkgJson = JSON.stringify({
  name: '@amodalai/connection-salesforce',
  version: '1.0.0',
  amodal: {name: 'salesforce', tags: ['connection']},
});

describe('runPublish', () => {
  let stderrOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({isFile: () => true, isDirectory: () => true});
    mockReadFile.mockResolvedValue(validPkgJson);
    mockReaddir.mockResolvedValue([]);
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
    expect(stderrOutput).toContain('salesforce');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should return 1 when package.json is unreadable', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Failed to read package.json');
  });

  it('should return 1 when amodal block missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/test',
      version: '1.0.0',
    }));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('amodal');
  });

  it('should return 1 when amodal name missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/test',
      version: '1.0.0',
      amodal: {tags: ['skill']},
    }));

    const {runPublish} = await import('./publish.js');
    const result = await runPublish();
    expect(result).toBe(1);
    expect(stderrOutput).toContain('name');
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

  it('should suggest npm login on auth error', async () => {
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

  it('should show package name and version in dry run', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      name: '@amodalai/connection-stripe',
      version: '3.2.1',
      amodal: {name: 'stripe', tags: ['connection']},
    }));

    const {runPublish} = await import('./publish.js');
    await runPublish({dryRun: true});
    expect(stderrOutput).toContain('@amodalai/connection-stripe@3.2.1');
  });
});
