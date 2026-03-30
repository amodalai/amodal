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

const validSpec = JSON.stringify({
  baseUrl: 'https://api.example.com',
  format: 'openapi',
});

const validAccess = JSON.stringify({
  endpoints: {
    'GET /items': {returns: ['item']},
    'PUT /items/{id}': {returns: ['item'], confirm: true},
  },
  fieldRestrictions: [
    {entity: 'item', field: 'secret', policy: 'never_retrieve', sensitivity: 'pii_identifier'},
  ],
});

const surfaceMd = `# Surface: Example

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

const knowledgeMd = `# Knowledge: Domain Rules

Items older than 30 days need review.
`;

const automationMd = `# Automation: Daily Check

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

  it('loads a full repo', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/connections/example-api/spec.json': validSpec,
      '/repo/connections/example-api/access.json': validAccess,
      '/repo/connections/example-api/surface.md': surfaceMd,
      '/repo/connections/example-api/entities.md': '# Entities\n\n### Item\nA thing.',
      '/repo/connections/example-api/rules.md': '# Rules\n\n- Rule one.',
      '/repo/skills/test-skill/SKILL.md': skillMd,
      '/repo/agents/main.md': '# Agent Override: Main\n\nBe direct.',
      '/repo/agents/simple.md': '# Agent Override: Simple\n\nReturn full data.',
      '/repo/knowledge/domain-rules.md': knowledgeMd,
      '/repo/automations/daily-check.md': automationMd,
      '/repo/evals/stale-item.md': evalMd,
    });

    const repo = await loadRepoFromDisk('/repo');

    // Config
    expect(repo.config.name).toBe('test-app');
    expect(repo.config.models.main.provider).toBe('anthropic');

    // Connections
    expect(repo.connections.size).toBe(1);
    const conn = repo.connections.get('example-api')!;
    expect(conn.spec.format).toBe('openapi');
    expect(conn.access.endpoints['GET /items']).toBeDefined();
    expect(conn.surface).toHaveLength(2);
    expect(conn.entities).toContain('Item');
    expect(conn.rules).toContain('Rule one');

    // Skills
    expect(repo.skills).toHaveLength(1);
    expect(repo.skills[0].name).toBe('Test Skill');
    expect(repo.skills[0].trigger).toBe('User asks about items.');

    // Agents
    expect(repo.agents.main).toContain('Be direct');
    expect(repo.agents.simple).toContain('Return full data');

    // Knowledge
    expect(repo.knowledge).toHaveLength(1);
    expect(repo.knowledge[0].title).toBe('Domain Rules');

    // Automations
    expect(repo.automations).toHaveLength(1);
    expect(repo.automations[0].title).toBe('Daily Check');
    expect(repo.automations[0].schedule).toBe('daily at 8:00 AM');

    // Evals
    expect(repo.evals).toHaveLength(1);
    expect(repo.evals[0].title).toBe('Stale Item');
    expect(repo.evals[0].assertions).toHaveLength(2);
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

  it('throws CONFIG_NOT_FOUND for missing spec.json in connection', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/connections/broken/access.json': validAccess,
    });

    try {
      await loadRepoFromDisk('/repo');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
      expect((err as RepoError).message).toContain('spec.json');
    }
  });

  it('throws CONFIG_NOT_FOUND for missing access.json in connection', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/connections/broken/spec.json': validSpec,
    });

    try {
      await loadRepoFromDisk('/repo');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe('CONFIG_NOT_FOUND');
      expect((err as RepoError).message).toContain('access.json');
    }
  });

  it('loads multiple connections', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/connections/api-one/spec.json': validSpec,
      '/repo/connections/api-one/access.json': validAccess,
      '/repo/connections/api-two/spec.json': validSpec,
      '/repo/connections/api-two/access.json': validAccess,
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.connections.size).toBe(2);
    expect(repo.connections.has('api-one')).toBe(true);
    expect(repo.connections.has('api-two')).toBe(true);
  });

  it('skips skills with unrecognized format', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/skills/valid/SKILL.md': skillMd,
      '/repo/skills/invalid/SKILL.md': 'Just some random text.',
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.skills).toHaveLength(1);
    expect(repo.skills[0].name).toBe('Test Skill');
  });

  it('handles missing agents directory', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.agents.main).toBeUndefined();
    expect(repo.agents.simple).toBeUndefined();
  });

  it('loads multiple knowledge files', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/knowledge/rules-a.md': '# Knowledge: Rules A\n\nRule A content.',
      '/repo/knowledge/rules-b.md': '# Knowledge: Rules B\n\nRule B content.',
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.knowledge).toHaveLength(2);
    const names = repo.knowledge.map((k) => k.name);
    expect(names).toContain('rules-a');
    expect(names).toContain('rules-b');
  });

  // --- Package resolution integration tests ---

  it('uses resolver when lock file has packages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    const mockConnections = new Map([['test-api', {spec: {}, access: {}, surface: [], entities: [], rules: []}]]);
    const mockSkills = [{name: 'Test Skill', description: '', body: 'body', location: '/pkg'}];

    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {'connection/test-api': {version: '1.0.0', npm: '@amodalai/connection-test-api', integrity: 'sha512-abc'}},
    });
    mockResolveAllPackages.mockResolvedValue({
      connections: mockConnections,
      skills: mockSkills,
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).toHaveBeenCalledOnce();
    expect(repo.connections).toBe(mockConnections);
    expect(repo.skills).toBe(mockSkills);
    expect(repo.warnings).toBeUndefined();
  });

  it('uses direct load when lock file has empty packages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue({lockVersion: 1, packages: {}});

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).not.toHaveBeenCalled();
    expect(repo.connections.size).toBe(0);
    expect(repo.skills).toEqual([]);
  });

  it('uses direct load when no lock file exists', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue(null);

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).not.toHaveBeenCalled();
    expect(repo.connections.size).toBe(0);
  });

  it('propagates resolver warnings', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {'skill/triage': {version: '1.0.0', npm: '@amodalai/skill-triage', integrity: 'sha512-abc'}},
    });
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: ['Package skill/triage is in lock file but not installed (broken symlink?)'],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.warnings).toEqual(['Package skill/triage is in lock file but not installed (broken symlink?)']);
  });

  it('loads agents and evals from disk even with packages', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
      '/repo/agents/main.md': '# Agent: Main\n\nBe direct.',
      '/repo/evals/test-eval.md': evalMd,
    });

    mockReadLockFile.mockResolvedValue({
      lockVersion: 1,
      packages: {'connection/api': {version: '1.0.0', npm: '@amodalai/connection-api', integrity: 'sha512-abc'}},
    });
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const repo = await loadRepoFromDisk('/repo');
    expect(repo.agents.main).toContain('Be direct');
    expect(repo.evals).toHaveLength(1);
    expect(repo.evals[0].title).toBe('Stale Item');
  });

  it('falls back to direct load when lock file read fails', async () => {
    mockFs({
      '/repo/amodal.json': minimalConfig,
    });

    mockReadLockFile.mockRejectedValue(new Error('corrupt lock file'));

    const repo = await loadRepoFromDisk('/repo');
    expect(mockResolveAllPackages).not.toHaveBeenCalled();
    expect(repo.connections.size).toBe(0);
  });
});
