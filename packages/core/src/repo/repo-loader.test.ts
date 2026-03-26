/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, afterEach} from 'vitest';
import mockFs from 'mock-fs';

import {loadRepo} from './repo-loader.js';
import {RepoError} from './repo-types.js';

const minimalConfig = JSON.stringify({
  name: 'test-app',
  version: '1.0.0',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
  },
});

describe('loadRepo', () => {
  afterEach(() => {
    mockFs.restore();
    vi.restoreAllMocks();
  });

  it('loads from local path', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    const repo = await loadRepo({localPath: '/repo'});
    expect(repo.source).toBe('local');
    expect(repo.config.name).toBe('test-app');
  });

  it('loads from platform URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = url.replace('https://platform.test.com', '');

        if (path === '/api/repo/config') {
          return new Response(minimalConfig, {status: 200});
        }
        if (path === '/api/repo/tree') {
          return new Response(
            JSON.stringify({
              connections: [],
              skills: [],
              agents: [],
              knowledge: [],
              automations: [],
              evals: [],
              tools: [],
            }),
            {status: 200},
          );
        }
        if (path === '/api/repo/agents/main' || path === '/api/repo/agents/explore') {
          return new Response('', {status: 404});
        }
        return new Response('Not Found', {status: 404});
      }),
    );

    const repo = await loadRepo({
      platformUrl: 'https://platform.test.com',
      platformApiKey: 'test-key',
    });
    expect(repo.source).toBe('platform');
    expect(repo.config.name).toBe('test-app');
  });

  it('prefers local path when both are provided', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    const repo = await loadRepo({
      localPath: '/repo',
      platformUrl: 'https://platform.test.com',
      platformApiKey: 'key',
    });
    expect(repo.source).toBe('local');
  });

  it('throws CONFIG_NOT_FOUND when no source configured', async () => {
    try {
      await loadRepo({});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
      expect((err as RepoError).message).toContain('No repo source configured');
    }
  });

  it('throws CONFIG_NOT_FOUND when only platformUrl without key', async () => {
    try {
      await loadRepo({platformUrl: 'https://platform.test.com'});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('throws CONFIG_NOT_FOUND when only platformApiKey without url', async () => {
    try {
      await loadRepo({platformApiKey: 'key'});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
    }
  });
});
