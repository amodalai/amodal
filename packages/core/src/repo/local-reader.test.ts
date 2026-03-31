/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach, vi} from 'vitest';
import mockFs from 'mock-fs';

import {loadRepoFromDisk} from './local-reader.js';
import {RepoError} from './repo-types.js';

// Module-level mocks for package resolution
const mockReadLockFile = vi.fn();
const mockResolveAllPackages = vi.fn();

vi.mock('../packages/lock-file.js', () => ({
  readLockFile: (...args: unknown[]) => mockReadLockFile(...args),
}));

vi.mock('../packages/resolver.js', () => ({
  resolveAllPackages: (...args: unknown[]) => mockResolveAllPackages(...args),
}));

const minimalConfig = JSON.stringify({
  name: 'test-app',
  version: '1.0.0',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-6'},
  },
});

const _validSpec = JSON.stringify({
  baseUrl: 'https://api.example.com',
  format: 'openapi',
});

const _validAccess = JSON.stringify({
  endpoints: {
    'GET /items': {returns: ['item']},
    'PUT /items/{id}': {returns: ['item'], confirm: true},
  },
  fieldRestrictions: [
    {entity: 'item', field: 'secret', policy: 'never_retrieve', sensitivity: 'pii_identifier'},
  ],
});

const _surfaceMd = `# Surface: Example

## Included Endpoints

### GET /items
List items.

### PUT /items/{id}
Update an item.
`;

const skillMd = `# Skill: Test Skill

Trigger: User asks about items.

## Behavior

Analyze items and provide insights.

## Constraints

- Always cite evidence.
`;

const _knowledgeMd = `# Knowledge: Domain Rules

Items older than 30 days need review.
`;

const _automationMd = `# Automation: Daily Check

Schedule: daily at 8:00 AM

## Check

Scan all items for staleness.

## Output

List of stale items.

## Delivery

POST to webhook.
`;

const evalMd = `# Eval: Stale Item

An item that hasn't been updated in 35 days.

## Setup

Tenant: test_tenant
Context: viewing item page

## Query

"Is this item stale?"

## Assertions

- Should flag as stale
- Should NOT recommend deletion
`;

/**
 * Default mock for resolveAllPackages that returns empty results.
 * This is needed because loadRepoFromDisk always calls resolveAllPackages now.
 */
function mockEmptyResolve(): void {
  mockResolveAllPackages.mockResolvedValue({
    connections: new Map(),
    skills: [],
    automations: [],
    knowledge: [],
    stores: [],
    tools: [],
    warnings: [],
  });
}

describe('loadRepoFromDisk', () => {
  afterEach(() => {
    mockFs.restore();
    vi.clearAllMocks();
    mockReadLockFile.mockResolvedValue(null);
    mockResolveAllPackages.mockReset();
  });

  it('loads a minimal repo (config only)', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });
    mockReadLockFile.mockResolvedValue(null);
    mockEmptyResolve();

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.source).toBe('local');
    expect(repo.origin).toBe('/repo');
    expect(repo.config.name).toBe('test-app');
    expect(repo.connections.size).toBe(0);
    expect(repo.skills).toEqual([]);
    expect(repo.agents).toEqual({main: undefined, simple: undefined, subagents: []});
    expect(repo.automations).toEqual([]);
    expect(repo.knowledge).toEqual([]);
    expect(repo.evals).toEqual([]);
  });

  it('loads a full repo via resolveAllPackages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/agents/main.md': '# Agent Override: Main\n\nBe direct.',
      '/repo/agents/simple.md': '# Agent Override: Simple\n\nReturn full data.',
      '/repo/evals/stale-item.md': evalMd,
    });

    const mockConnections = new Map([
      ['example-api', {
        name: 'example-api',
        spec: {format: 'openapi', baseUrl: 'https://api.example.com'},
        access: {
          endpoints: {
            'GET /items': {returns: ['item']},
            'PUT /items/{id}': {returns: ['item'], confirm: true},
          },
        },
        surface: [
          {method: 'GET', path: '/items', description: 'List items.'},
          {method: 'PUT', path: '/items/{id}', description: 'Update an item.'},
        ],
        entities: 'Item\nA thing.',
        rules: 'Rule one.',
        location: '/repo/connections/example-api',
      }],
    ]);
    const mockSkills = [{name: 'Test Skill', trigger: 'User asks about items.', description: '', body: 'body', location: '/repo/skills/test-skill'}];
    const mockKnowledge = [{name: 'domain-rules', title: 'Domain Rules', body: 'Items older than 30 days need review.', location: '/repo/knowledge/domain-rules.md'}];
    const mockAutomations = [{name: 'daily-check', title: 'Daily Check', schedule: 'daily at 8:00 AM', location: '/repo/automations/daily-check.md'}];

    mockReadLockFile.mockResolvedValue(null);
    mockResolveAllPackages.mockResolvedValue({
      connections: mockConnections,
      skills: mockSkills,
      automations: mockAutomations,
      knowledge: mockKnowledge,
      stores: [],
      tools: [],
      warnings: [],
    });

    const repo = await loadRepoFromDisk('/repo');

    // Config
    expect(repo.config.name).toBe('test-app');
    expect(repo.config.models.main.provider).toBe('anthropic');

    // Connections (from resolver)
    expect(repo.connections.size).toBe(1);

    // Skills (from resolver)
    expect(repo.skills).toHaveLength(1);
    expect(repo.skills[0].name).toBe('Test Skill');

    // Agents (always loaded from disk)
    expect(repo.agents.main).toContain('Be direct');
    expect(repo.agents.simple).toContain('Return full data');

    // Knowledge (from resolver)
    expect(repo.knowledge).toHaveLength(1);

    // Automations (from resolver)
    expect(repo.automations).toHaveLength(1);

    // Evals (always loaded from disk)
    expect(repo.evals).toHaveLength(1);
    expect(repo.evals[0].title).toBe('Stale Item');
  });

  it('throws CONFIG_NOT_FOUND for missing repo path', async () => {
    mockFs({});

    try {
      await loadRepoFromDisk('/nonexistent');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('throws CONFIG_NOT_FOUND for missing config.json', async () => {
    mockFs({
      '/repo/skills/test/SKILL.md': skillMd,
    });

    try {
      await loadRepoFromDisk('/repo');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('throws CONFIG_PARSE_FAILED for invalid config JSON', async () => {
    mockFs({
      '/repo/amodal.json': 'not json',
    });

    try {
      await loadRepoFromDisk('/repo');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('handles missing agents directory', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });
    mockReadLockFile.mockResolvedValue(null);
    mockEmptyResolve();

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.agents.main).toBeUndefined();
    expect(repo.agents.simple).toBeUndefined();
  });

  // --- Package resolution integration tests ---

  it('always calls resolveAllPackages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue(null);
    mockEmptyResolve();

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).toHaveBeenCalledOnce();
    expect(repo.connections.size).toBe(0);
    expect(repo.skills).toEqual([]);
  });

  it('passes lock file to resolveAllPackages when present', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    const lockFile = {
      lockVersion: 2,
      packages: {'@amodalai/connection-test-api': {version: '1.0.0', integrity: 'sha512-abc'}},
    };
    const mockConnections = new Map([['test-api', {spec: {}, access: {}, surface: [], entities: [], rules: []}]]);

    mockReadLockFile.mockResolvedValue(lockFile);
    mockResolveAllPackages.mockResolvedValue({
      connections: mockConnections,
      skills: [],
      automations: [],
      knowledge: [],
      stores: [],
      tools: [],
      warnings: [],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).toHaveBeenCalledExactlyOnceWith({repoPath: '/repo', lockFile});
    expect(repo.connections).toBe(mockConnections);
    expect(repo.warnings).toBeUndefined();
  });

  it('passes null lock file to resolveAllPackages when no lock file', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue(null);
    mockEmptyResolve();

    await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).toHaveBeenCalledWith({repoPath: '/repo', lockFile: null});
  });

  it('propagates resolver warnings', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {'@amodalai/skill-triage': {version: '1.0.0', integrity: 'sha512-abc'}},
    });
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      stores: [],
      tools: [],
      warnings: ['Package @amodalai/skill-triage is in lock file but not installed'],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.warnings).toEqual(['Package @amodalai/skill-triage is in lock file but not installed']);
  });

  it('loads agents and evals from disk even with packages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/agents/main.md': '# Agent: Main\n\nBe direct.',
      '/repo/evals/test-eval.md': evalMd,
    });

    mockReadLockFile.mockResolvedValue({
      lockVersion: 2,
      packages: {'@amodalai/connection-api': {version: '1.0.0', integrity: 'sha512-abc'}},
    });
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      stores: [],
      tools: [],
      warnings: [],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.agents.main).toContain('Be direct');
    expect(repo.evals).toHaveLength(1);
    expect(repo.evals[0].title).toBe('Stale Item');
  });

  it('falls back to null lock file when lock file read fails', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockRejectedValue(new Error('corrupt lock file'));
    mockEmptyResolve();

    const repo = await loadRepoFromDisk('/repo');
    // resolveAllPackages is still called with null lock file
    expect(mockResolveAllPackages).toHaveBeenCalledWith({repoPath: '/repo', lockFile: null});
    expect(repo.connections.size).toBe(0);
  });
});
