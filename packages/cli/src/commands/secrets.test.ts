/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

describe('runSecrets', () => {
  let stderrOutput: string;
  let stdoutOutput: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      PLATFORM_API_URL: 'https://api.example.com',
      PLATFORM_API_KEY: 'test-key',
    };
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
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  it('should set a secret', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'set', key: 'DB_URL', value: 'postgres://...'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('set successfully');
  });

  it('should return 1 when key missing for set', async () => {
    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'set'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Missing key');
  });

  it('should return 1 when value missing for set', async () => {
    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'set', key: 'DB_URL'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Missing value');
  });

  it('should list secrets', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([
      {key: 'DB_URL'},
      {key: 'API_KEY'},
    ]), {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'list'});
    expect(result).toBe(0);
    expect(stdoutOutput).toContain('DB_URL');
    expect(stdoutOutput).toContain('API_KEY');
  });

  it('should list secrets as JSON', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([{key: 'DB_URL'}]), {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'list', json: true});
    expect(result).toBe(0);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed).toHaveLength(1);
  });

  it('should handle empty secrets list', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'list'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('No secrets configured');
  });

  it('should delete a secret', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'delete', key: 'DB_URL'});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('deleted');
  });

  it('should return 1 when key missing for delete', async () => {
    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'delete'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('Missing key');
  });

  it('should return 1 when platform not configured', async () => {
    delete process.env['PLATFORM_API_URL'];
    delete process.env['PLATFORM_API_KEY'];

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'list'});
    expect(result).toBe(1);
  });

  it('should handle auth failure', async () => {
    fetchSpy.mockResolvedValue(new Response('Unauthorized', {status: 401}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'list'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('401');
  });

  it('should handle network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'set', key: 'K', value: 'V'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('ECONNREFUSED');
  });

  it('should handle set server error', async () => {
    fetchSpy.mockResolvedValue(new Response('Internal Error', {status: 500}));

    const {runSecrets} = await import('./secrets.js');
    const result = await runSecrets({subcommand: 'set', key: 'K', value: 'V'});
    expect(result).toBe(1);
    expect(stderrOutput).toContain('500');
  });

  it('should show count for listed secrets', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([
      {key: 'A'},
      {key: 'B'},
      {key: 'C'},
    ]), {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    await runSecrets({subcommand: 'list'});
    expect(stderrOutput).toContain('3 secrets');
  });

  it('should use singular for single secret', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([{key: 'ONLY'}]), {status: 200}));

    const {runSecrets} = await import('./secrets.js');
    await runSecrets({subcommand: 'list'});
    expect(stderrOutput).toContain('1 secret configured');
    expect(stderrOutput).not.toContain('1 secrets');
  });
});
