/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterAll} from 'vitest';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {parseSurfaceFromSnapshot, loadSnapshotFromFile, snapshotToBundle} from './snapshot-loader.js';
import type {DeploySnapshot} from './snapshot-types.js';

const testDir = join(tmpdir(), `snapshot-test-${randomBytes(4).toString('hex')}`);
mkdirSync(testDir, {recursive: true});
afterAll(() => { rmSync(testDir, {recursive: true, force: true}); });

function makeSnapshot(overrides: Partial<DeploySnapshot> = {}): DeploySnapshot {
  return {
    deployId: 'deploy-abc1234',
    createdAt: '2026-03-18T10:00:00.000Z',
    createdBy: 'test@example.com',
    source: 'cli',
    config: {
      name: 'test-agent',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    },
    connections: {},
    skills: [],
    automations: [],
    knowledge: [],
    ...overrides,
  };
}

describe('parseSurfaceFromSnapshot', () => {
  it('returns empty for empty string', () => {
    expect(parseSurfaceFromSnapshot('')).toEqual([]);
  });

  it('parses included and excluded endpoints', () => {
    const md = '- [x] GET /users — List users\n- [ ] DELETE /users/:id — Delete user';
    const result = parseSurfaceFromSnapshot(md);
    expect(result).toEqual([
      {method: 'GET', path: '/users', description: 'List users', included: true},
      {method: 'DELETE', path: '/users/:id', description: 'Delete user', included: false},
    ]);
  });

  it('parses GraphQL operationType prefix', () => {
    const md = '- [x] query POST /graphql — Get users\n- [x] mutation POST /graphql — Create user';
    const result = parseSurfaceFromSnapshot(md);
    expect(result).toEqual([
      {method: 'POST', path: '/graphql', description: 'Get users', included: true, operationType: 'query'},
      {method: 'POST', path: '/graphql', description: 'Create user', included: true, operationType: 'mutation'},
    ]);
  });

  it('skips non-matching lines', () => {
    const md = '# Surface\n\n- [x] GET /users — List users\nSome text\n';
    const result = parseSurfaceFromSnapshot(md);
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('GET');
  });
});

describe('loadSnapshotFromFile', () => {
  it('loads and validates a snapshot from disk', async () => {
    const snapshot = makeSnapshot();
    const filePath = join(testDir, 'valid.json');
    writeFileSync(filePath, JSON.stringify(snapshot));

    const result = await loadSnapshotFromFile(filePath);
    expect(result.deployId).toBe('deploy-abc1234');
    expect(result.config.name).toBe('test-agent');
  });

  it('throws on read failure', async () => {
    await expect(loadSnapshotFromFile(join(testDir, 'nonexistent.json'))).rejects.toThrow('Failed to read snapshot file');
  });

  it('throws on invalid JSON', async () => {
    const filePath = join(testDir, 'bad.json');
    writeFileSync(filePath, 'not json');

    await expect(loadSnapshotFromFile(filePath)).rejects.toThrow('Invalid JSON');
  });

  it('throws on schema validation failure', async () => {
    const filePath = join(testDir, 'invalid.json');
    writeFileSync(filePath, JSON.stringify({deployId: 'bad'}));

    await expect(loadSnapshotFromFile(filePath)).rejects.toThrow('Snapshot validation failed');
  });
});

describe('snapshotToBundle', () => {
  it('converts a minimal snapshot to AgentBundle', () => {
    const snapshot = makeSnapshot();
    const repo = snapshotToBundle(snapshot, '/tmp/snapshot.json');

    expect(repo.source).toBe('platform');
    expect(repo.origin).toBe('/tmp/snapshot.json');
    expect(repo.config.name).toBe('test-agent');
    expect(repo.connections.size).toBe(0);
    expect(repo.skills).toEqual([]);
    expect(repo.automations).toEqual([]);
    expect(repo.knowledge).toEqual([]);
    expect(repo.evals).toEqual([]);
  });

  it('converts connections with surface parsing', () => {
    const snapshot = makeSnapshot({
      connections: {
        stripe: {
          spec: {source: 'https://api.stripe.com/spec', format: 'openapi'},
          surface: '- [x] GET /charges — List charges\n- [ ] POST /charges — Create charge',
          access: {endpoints: {'/charges': {returns: ['id']}}},
          entities: '# Entities',
          rules: '# Rules',
        },
      },
    });

    const repo = snapshotToBundle(snapshot, 'test');
    const conn = repo.connections.get('stripe');
    expect(conn).toBeDefined();
    expect(conn?.surface).toHaveLength(2);
    expect(conn?.surface[0].method).toBe('GET');
    expect(conn?.surface[0].included).toBe(true);
    expect(conn?.surface[1].included).toBe(false);
    expect(conn?.entities).toBe('# Entities');
    expect(conn?.rules).toBe('# Rules');
    expect(conn?.location).toBe('snapshot:deploy-abc1234');
  });

  it('converts skills, automations, knowledge, and agents', () => {
    const snapshot = makeSnapshot({
      skills: [{name: 'triage', description: 'Triage', body: '# Triage', trigger: 'on request'}],
      automations: [{name: 'daily', title: 'Daily', schedule: '0 9 * * *', check: 'check', output: 'out', delivery: 'slack', raw: 'raw'}],
      knowledge: [{name: 'docs', title: 'Docs', body: '# Docs'}],
      agents: {main: '# Main agent', simple: '# Explorer'},
    });

    const repo = snapshotToBundle(snapshot, 'test');
    expect(repo.skills).toHaveLength(1);
    expect(repo.skills[0].name).toBe('triage');
    expect(repo.skills[0].trigger).toBe('on request');
    expect(repo.skills[0].location).toBe('snapshot:deploy-abc1234');
    expect(repo.automations).toHaveLength(1);
    expect(repo.automations[0].schedule).toBe('0 9 * * *');
    expect(repo.knowledge).toHaveLength(1);
    expect(repo.agents.main).toBe('# Main agent');
    expect(repo.agents.simple).toBe('# Explorer');
  });
});
