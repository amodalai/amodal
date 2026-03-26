/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {PlatformClient} from './platform-client.js';

describe('PlatformClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws if PLATFORM_API_URL not set', () => {
    const origUrl = process.env['PLATFORM_API_URL'];
    const origKey = process.env['PLATFORM_API_KEY'];
    delete process.env['PLATFORM_API_URL'];
    delete process.env['PLATFORM_API_KEY'];

    try {
      expect(() => new PlatformClient()).toThrow('Platform URL not found');
    } finally {
      if (origUrl) process.env['PLATFORM_API_URL'] = origUrl;
      if (origKey) process.env['PLATFORM_API_KEY'] = origKey;
    }
  });

  it('throws if PLATFORM_API_KEY not set', () => {
    expect(() => new PlatformClient({url: 'http://localhost:4000'})).toThrow('Platform auth not found');
  });

  it('creates client with explicit options', () => {
    const client = new PlatformClient({url: 'http://localhost:4000', apiKey: 'test-key'});
    expect(client).toBeDefined();
  });

  it('uploads snapshot via POST', async () => {
    const mockResponse = {
      id: 'deploy-abc1234',
      environment: 'production',
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: 'test',
      source: 'cli',
      snapshotSize: 1024,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new PlatformClient({url: 'http://localhost:4000', apiKey: 'key'});
    const result = await client.uploadSnapshot({
      deployId: 'deploy-abc1234',
      createdAt: new Date().toISOString(),
      createdBy: 'test',
      source: 'cli',
      config: {name: 'test', version: '1.0', models: {main: {provider: 'a', model: 'b'}}},
      connections: {},
      skills: [],
      automations: [],
      knowledge: [],
    });

    expect(result.id).toBe('deploy-abc1234');
     
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(fetchCall[0]).toBe('http://localhost:4000/api/snapshot-deployments');
    expect(fetchCall[1].method).toBe('POST');
  });

  it('lists deployments via GET', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const client = new PlatformClient({url: 'http://localhost:4000', apiKey: 'key'});
    const result = await client.listDeployments({environment: 'staging', limit: 5});

    expect(result).toEqual([]);
     
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(fetchCall[0]).toContain('environment=staging');
    expect(fetchCall[0]).toContain('limit=5');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({error: 'Unauthorized'}),
    });

    const client = new PlatformClient({url: 'http://localhost:4000', apiKey: 'bad-key'});
    await expect(client.listDeployments()).rejects.toThrow('failed (401)');
  });
});
