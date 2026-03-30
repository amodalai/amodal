/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach, vi} from 'vitest';

import {loadRepoFromPlatform} from './platform-reader.js';
import {RepoError} from './repo-types.js';

const minimalConfig = JSON.stringify({
  name: 'test-app',
  version: '1.0.0',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
  },
});

const validSpec = JSON.stringify({
  baseUrl: 'https://api.example.com',
  format: 'openapi',
});

const validAccess = JSON.stringify({
  endpoints: {'GET /items': {returns: ['item']}},
});

const tree = {
  connections: ['test-api'],
  skills: ['advisor'],
  agents: ['main'],
  knowledge: ['domain-rules'],
  automations: ['daily-check'],
  evals: ['basic-test'],
  tools: [],
};

const skillContent = `# Skill: Advisor

Trigger: User asks for advice.

## Behavior

Give advice.
`;

const knowledgeContent = `# Knowledge: Domain Rules

Important rules here.
`;

const automationContent = `# Automation: Daily Check

Schedule: daily at 8:00 AM

## Check

Check things.

## Output

Report.

## Delivery

Webhook.
`;

const evalContent = `# Eval: Basic Test

A basic test.

## Setup

Tenant: test_tenant

## Query

"What is happening?"

## Assertions

- Should answer correctly
`;

function mockFetchResponses(
  overrides: Record<string, {status: number; body: string} | null> = {},
): void {
  const responses: Record<string, {status: number; body: string}> = {
    '/api/repo/config': {status: 200, body: minimalConfig},
    '/api/repo/tree': {status: 200, body: JSON.stringify(tree)},
    '/api/repo/connections/test-api/spec': {status: 200, body: validSpec},
    '/api/repo/connections/test-api/access': {status: 200, body: validAccess},
    '/api/repo/connections/test-api/surface': {status: 200, body: '### GET /items\nList items.'},
    '/api/repo/connections/test-api/entities': {status: 404, body: ''},
    '/api/repo/connections/test-api/rules': {status: 404, body: ''},
    '/api/repo/skills/advisor': {status: 200, body: skillContent},
    '/api/repo/agents/main': {status: 200, body: '# Main\n\nBe direct.'},
    '/api/repo/agents/explore': {status: 404, body: ''},
    '/api/repo/knowledge/domain-rules': {status: 200, body: knowledgeContent},
    '/api/repo/automations/daily-check': {status: 200, body: automationContent},
    '/api/repo/evals/basic-test': {status: 200, body: evalContent},
    ...overrides,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = url.replace('https://platform.example.com', '');
      const resp = responses[path];

      if (!resp) {
        return new Response('Not Found', {status: 404});
      }

      return new Response(resp.body, {
        status: resp.status,
        headers: {'Content-Type': resp.status === 404 ? 'text/plain' : 'application/json'},
      });
    }),
  );
}

describe('loadRepoFromPlatform', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a full repo from platform', async () => {
    mockFetchResponses();

    const repo = await loadRepoFromPlatform(
      'https://platform.example.com',
      'test-api-key',
    );

    expect(repo.source).toBe('platform');
    expect(repo.origin).toBe('https://platform.example.com');
    expect(repo.config.name).toBe('test-app');

    // Connections
    expect(repo.connections.size).toBe(1);
    const conn = repo.connections.get('test-api')!;
    expect(conn.spec.format).toBe('openapi');
    expect(conn.surface).toHaveLength(1);
    expect(conn.entities).toBeUndefined();

    // Skills
    expect(repo.skills).toHaveLength(1);
    expect(repo.skills[0].name).toBe('Advisor');

    // Agents
    expect(repo.agents.main).toContain('Be direct');
    expect(repo.agents.explore).toBeUndefined();

    // Knowledge
    expect(repo.knowledge).toHaveLength(1);
    expect(repo.knowledge[0].title).toBe('Domain Rules');

    // Automations
    expect(repo.automations).toHaveLength(1);
    expect(repo.automations[0].title).toBe('Daily Check');

    // Evals
    expect(repo.evals).toHaveLength(1);
    expect(repo.evals[0].title).toBe('Basic Test');
  });

  it('sends Authorization header', async () => {
    mockFetchResponses();
    await loadRepoFromPlatform('https://platform.example.com', 'my-secret-key');

     
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
     
    const firstCallOptions = calls[0][1] as Record<string, unknown>;
     
    const headers = firstCallOptions['headers'] as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  it('throws CONFIG_NOT_FOUND when config returns 404', async () => {
    mockFetchResponses({
      '/api/repo/config': {status: 404, body: ''},
    });

    try {
      await loadRepoFromPlatform('https://platform.example.com', 'key');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('throws PLATFORM_FETCH_FAILED on 401', async () => {
    mockFetchResponses({
      '/api/repo/config': {status: 401, body: 'Unauthorized'},
    });

    try {
      await loadRepoFromPlatform('https://platform.example.com', 'bad-key');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('PLATFORM_FETCH_FAILED');
    }
  });

  it('throws PLATFORM_FETCH_FAILED on 500', async () => {
    mockFetchResponses({
      '/api/repo/config': {status: 500, body: 'Internal Error'},
    });

    try {
      await loadRepoFromPlatform('https://platform.example.com', 'key');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('PLATFORM_FETCH_FAILED');
    }
  });

  it('throws READ_FAILED when connection spec is missing', async () => {
    mockFetchResponses({
      '/api/repo/connections/test-api/spec': {status: 404, body: ''},
    });

    try {
      await loadRepoFromPlatform('https://platform.example.com', 'key');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('READ_FAILED');
      expect((err as RepoError).message).toContain('spec.json');
    }
  });

  it('throws PLATFORM_FETCH_FAILED on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error');
      }),
    );

    try {
      await loadRepoFromPlatform('https://platform.example.com', 'key');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('PLATFORM_FETCH_FAILED');
    }
  });

  it('strips trailing slash from URL', async () => {
    mockFetchResponses();
    await loadRepoFromPlatform('https://platform.example.com/', 'key');

     
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const urls = fetchMock.mock.calls.map(
       
      (call) => call[0] as string,
    );
    // No double slashes
    for (const url of urls) {
      expect(url).not.toContain('//api');
    }
  });

  it('handles empty tree', async () => {
    mockFetchResponses({
      '/api/repo/tree': {
        status: 200,
        body: JSON.stringify({
          connections: [],
          skills: [],
          agents: [],
          knowledge: [],
          automations: [],
          evals: [],
          tools: [],
        }),
      },
    });

    const repo = await loadRepoFromPlatform('https://platform.example.com', 'key');
    expect(repo.connections.size).toBe(0);
    expect(repo.skills).toEqual([]);
    expect(repo.knowledge).toEqual([]);
    expect(repo.automations).toEqual([]);
    expect(repo.evals).toEqual([]);
  });
});
