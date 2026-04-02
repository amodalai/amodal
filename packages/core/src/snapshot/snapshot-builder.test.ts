/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {AgentBundle} from '../repo/repo-types.js';
import type {SurfaceEndpoint} from '../repo/connection-types.js';
import {
  generateDeployId,
  serializeSurface,
  buildSnapshot,
  serializeSnapshot,
  snapshotSizeBytes,
} from './snapshot-builder.js';
import {DeploySnapshotSchema} from './snapshot-types.js';

function makeRepo(overrides: Partial<AgentBundle> = {}): AgentBundle {
  return {
    source: 'local',
    origin: '/tmp/test-repo',
    config: {
      name: 'test-agent',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    },
    connections: new Map(),
    skills: [],
    agents: {},
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
    ...overrides,
  };
}

describe('generateDeployId', () => {
  it('produces deploy-XXXXXXX format', () => {
    const id = generateDeployId();
    expect(id).toMatch(/^deploy-[0-9a-f]{7}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({length: 100}, () => generateDeployId()));
    expect(ids.size).toBeGreaterThan(90);
  });
});

describe('serializeSurface', () => {
  it('returns empty string for no endpoints', () => {
    expect(serializeSurface([])).toBe('');
  });

  it('serializes included and excluded endpoints', () => {
    const endpoints: SurfaceEndpoint[] = [
      {method: 'GET', path: '/users', description: 'List users', included: true},
      {method: 'DELETE', path: '/users/:id', description: 'Delete user', included: false},
    ];
    const result = serializeSurface(endpoints);
    expect(result).toBe(
      '- [x] GET /users — List users\n- [ ] DELETE /users/:id — Delete user',
    );
  });

  it('includes operationType prefix for GraphQL', () => {
    const endpoints: SurfaceEndpoint[] = [
      {method: 'POST', path: '/graphql', description: 'Get users', included: true, operationType: 'query'},
    ];
    const result = serializeSurface(endpoints);
    expect(result).toBe('- [x] query POST /graphql — Get users');
  });
});

describe('buildSnapshot', () => {
  it('creates a valid snapshot from a minimal repo', () => {
    const repo = makeRepo();
    const snapshot = buildSnapshot(repo, {createdBy: 'test@example.com', source: 'cli'});

    expect(snapshot.deployId).toMatch(/^deploy-[0-9a-f]{7}$/);
    expect(snapshot.createdBy).toBe('test@example.com');
    expect(snapshot.source).toBe('cli');
    expect(snapshot.config.name).toBe('test-agent');
    expect(snapshot.connections).toEqual({});
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.automations).toEqual([]);
    expect(snapshot.knowledge).toEqual([]);
    expect(snapshot.agents).toBeUndefined();

    // Validate with Zod
    const parsed = DeploySnapshotSchema.parse(snapshot);
    expect(parsed.deployId).toBe(snapshot.deployId);
  });

  it('includes connections, skills, automations, and knowledge', () => {
    const connections = new Map();
    connections.set('stripe', {
      name: 'stripe',
      spec: {source: 'https://api.stripe.com/spec', format: 'openapi' as const},
      access: {endpoints: {'/charges': {returns: ['id', 'amount']}}},
      surface: [
        {method: 'GET', path: '/charges', description: 'List charges', included: true},
      ],
      entities: '# Entities\n- Charge',
      rules: '# Rules\nNo PII in logs',
      location: '/tmp/connections/stripe',
    });

    const repo = makeRepo({
      connections,
      skills: [{name: 'triage', description: 'Triage skill', body: '# Triage\nDo triage.', location: '/tmp/skills/triage'}],
      automations: [{
        name: 'daily-check', title: 'Daily Check', schedule: '0 9 * * *',
        check: 'Check things', output: 'summary', delivery: 'slack', raw: '---\ntitle: Daily Check\n---',
        location: '/tmp/automations/daily-check',
      }],
      knowledge: [{name: 'api-docs', title: 'API Docs', body: '# API\nEndpoints here.', location: '/tmp/knowledge/api-docs'}],
      agents: {main: '# Main Agent\nYou are an expert.'},
    });

    const snapshot = buildSnapshot(repo, {createdBy: 'admin', source: 'admin-ui', commitSha: 'abc1234', message: 'Deploy v1'});

    expect(snapshot.connections['stripe']).toBeDefined();
    expect(snapshot.connections['stripe'].spec.format).toBe('openapi');
    expect(snapshot.connections['stripe'].surface).toContain('- [x] GET /charges');
    expect(snapshot.connections['stripe'].entities).toBe('# Entities\n- Charge');
    expect(snapshot.connections['stripe'].rules).toBe('# Rules\nNo PII in logs');
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].name).toBe('triage');
    expect(snapshot.automations).toHaveLength(1);
    expect(snapshot.automations[0].schedule).toBe('0 9 * * *');
    expect(snapshot.knowledge).toHaveLength(1);
    expect(snapshot.agents?.main).toBe('# Main Agent\nYou are an expert.');
    expect(snapshot.commitSha).toBe('abc1234');
    expect(snapshot.message).toBe('Deploy v1');
  });

  it('omits optional fields when not present', () => {
    const repo = makeRepo({
      skills: [{name: 's1', description: 'Skill', body: 'body', location: '/tmp'}],
    });
    const snapshot = buildSnapshot(repo, {createdBy: 'user', source: 'cli'});

    expect(snapshot.commitSha).toBeUndefined();
    expect(snapshot.message).toBeUndefined();
    expect(snapshot.agents).toBeUndefined();
    expect(snapshot.skills[0].trigger).toBeUndefined();
  });
});

describe('serializeSnapshot / snapshotSizeBytes', () => {
  it('serializes to valid JSON and reports size', () => {
    const snapshot = buildSnapshot(makeRepo(), {createdBy: 'test', source: 'cli'});
    const serialized = serializeSnapshot(snapshot);

    expect(JSON.parse(serialized)).toEqual(snapshot);

    const size = snapshotSizeBytes(serialized);
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(Buffer.byteLength(serialized, 'utf-8'));
  });
});
