/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {PackageAuth} from '@amodalai/core';

const mockReadEnvFile = vi.fn<(path: string) => Promise<Map<string, string>>>();

vi.mock('@amodalai/core', () => ({
  readEnvFile: (...args: unknown[]) => mockReadEnvFile(args[0] as string),
}));

import {resolveEndpointUrl, buildAuthHeaders, testConnection} from './test-connection.js';

describe('resolveEndpointUrl', () => {
  it('substitutes $VAR placeholders', () => {
    const env = new Map([['BASE_URL', 'https://api.example.com']]);
    expect(resolveEndpointUrl('$BASE_URL/users', env)).toBe(
      'https://api.example.com/users',
    );
  });

  it('substitutes ${VAR} placeholders', () => {
    const env = new Map([['HOST', 'example.com']]);
    expect(resolveEndpointUrl('https://${HOST}/api', env)).toBe(
      'https://example.com/api',
    );
  });

  it('replaces missing vars with empty string', () => {
    const env = new Map<string, string>();
    expect(resolveEndpointUrl('$MISSING/path', env)).toBe('/path');
  });

  it('handles multiple vars', () => {
    const env = new Map([
      ['HOST', 'example.com'],
      ['PORT', '8080'],
    ]);
    expect(resolveEndpointUrl('https://${HOST}:$PORT/api', env)).toBe(
      'https://example.com:8080/api',
    );
  });
});

describe('buildAuthHeaders', () => {
  it('returns empty for no auth', () => {
    const env = new Map<string, string>();
    expect(buildAuthHeaders(undefined, env)).toEqual({});
  });

  it('builds Bearer header for bearer auth', () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {MY_TOKEN: 'token desc'},
    };
    const env = new Map([['MY_TOKEN', 'secret123']]);
    expect(buildAuthHeaders(auth, env)).toEqual({
      Authorization: 'Bearer secret123',
    });
  });

  it('builds custom headers for api_key auth', () => {
    const auth: PackageAuth = {
      type: 'api_key',
      headers: {'X-Api-Key': '$API_KEY'},
    };
    const env = new Map([['API_KEY', 'mykey']]);
    expect(buildAuthHeaders(auth, env)).toEqual({
      'X-Api-Key': 'mykey',
    });
  });

  it('builds Bearer header for oauth2 auth', () => {
    const auth: PackageAuth = {
      type: 'oauth2',
      authorizeUrl: 'https://example.com/auth',
      tokenUrl: 'https://example.com/token',
      envVars: {ACCESS_TOKEN: 'Access token'},
    };
    const env = new Map([['ACCESS_TOKEN', 'oauth-token']]);
    expect(buildAuthHeaders(auth, env)).toEqual({
      Authorization: 'Bearer oauth-token',
    });
  });

  it('returns empty when token not in env', () => {
    const auth: PackageAuth = {
      type: 'bearer',
      envVars: {TOKEN: 'desc'},
    };
    const env = new Map<string, string>();
    expect(buildAuthHeaders(auth, env)).toEqual({});
  });
});

describe('testConnection', () => {
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy type mismatch with globalThis.fetch overloads
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadEnvFile.mockResolvedValue(new Map());
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('reports success for OK response with JSON array', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([1, 2, 3]), {status: 200}),
    );

    const report = await testConnection({
      connectionName: 'test',
      testEndpoints: ['https://api.example.com/items'],
      envFilePath: '/tmp/.env',
    });

    expect(report.allPassed).toBe(true);
    expect(report.results[0].status).toBe('ok');
    expect(report.results[0].recordCount).toBe(3);
  });

  it('reports success with count field in JSON', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({count: 42, items: []}), {status: 200}),
    );

    const report = await testConnection({
      connectionName: 'test',
      testEndpoints: ['https://api.example.com/items'],
      envFilePath: '/tmp/.env',
    });

    expect(report.results[0].recordCount).toBe(42);
  });

  it('reports error for HTTP failure', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Unauthorized', {status: 401}),
    );

    const report = await testConnection({
      connectionName: 'test',
      testEndpoints: ['https://api.example.com/items'],
      envFilePath: '/tmp/.env',
    });

    expect(report.allPassed).toBe(false);
    expect(report.results[0].status).toBe('error');
    expect(report.results[0].statusCode).toBe(401);
  });

  it('reports error for network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await testConnection({
      connectionName: 'test',
      testEndpoints: ['https://api.example.com/items'],
      envFilePath: '/tmp/.env',
    });

    expect(report.allPassed).toBe(false);
    expect(report.results[0].status).toBe('error');
    expect(report.results[0].error).toBe('ECONNREFUSED');
  });

  it('tests endpoints sequentially', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('[]', {status: 200}))
      .mockResolvedValueOnce(new Response('Forbidden', {status: 403}));

    const report = await testConnection({
      connectionName: 'multi',
      testEndpoints: [
        'https://api.example.com/a',
        'https://api.example.com/b',
      ],
      envFilePath: '/tmp/.env',
    });

    expect(report.results).toHaveLength(2);
    expect(report.results[0].status).toBe('ok');
    expect(report.results[1].status).toBe('error');
    expect(report.allPassed).toBe(false);
  });

  it('resolves URL placeholders from env', async () => {
    mockReadEnvFile.mockResolvedValue(
      new Map([['BASE', 'https://api.example.com']]),
    );
    fetchSpy.mockResolvedValue(new Response('[]', {status: 200}));

    await testConnection({
      connectionName: 'test',
      testEndpoints: ['$BASE/items'],
      envFilePath: '/tmp/.env',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.anything(),
    );
  });

  it('writes progress to stderr', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', {status: 200}));

    await testConnection({
      connectionName: 'test',
      testEndpoints: ['https://api.example.com/items'],
      envFilePath: '/tmp/.env',
    });

    expect(stderrSpy).toHaveBeenCalled();
  });
});
