/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createInspectRouter} from './inspect.js';
import type {SessionManager} from '../../session/session-manager.js';

function makeSessionManager(): SessionManager {
  return {
    size: 0,
    create: vi.fn(async () => ({
      id: 'inspect-session',
      appId: '__inspect__',
      runtime: {
        compiledContext: {
          systemPrompt: 'You are a test agent.',
          tokenUsage: {total: 100000, used: 500, remaining: 99500, sectionBreakdown: {core: 200, skills: 300}},
          sections: [
            {name: 'core', content: 'Core instructions', tokens: 200, priority: 10, trimmed: false},
            {name: 'skills', content: 'Skill definitions', tokens: 300, priority: 5, trimmed: false},
          ],
        },
        repo: {
          connections: new Map([['crm', {name: 'crm', spec: {baseUrl: 'https://api.example.com', testPath: undefined}, surface: [], entities: null, rules: null, location: 'connections/crm'}]]),
          skills: [{name: 'triage'}, {name: 'investigate'}],
          automations: [{name: 'daily-scan'}],
          knowledge: [{name: 'api-docs'}],
        },
      },
    })),
    destroy: vi.fn(),
    get: vi.fn(),
    cleanup: vi.fn(),
    updateRepo: vi.fn(),
    shutdown: vi.fn(),
    getRepo: vi.fn(() => ({
      connections: new Map([['crm', {name: 'crm', spec: {baseUrl: 'https://api.example.com', testPath: undefined}, surface: [], entities: null, rules: null, location: 'connections/crm'}]]),
      config: {name: 'test-agent', models: {main: {model: 'test-model', provider: 'test'}}},
      skills: [{name: 'triage'}, {name: 'investigate'}],
      automations: [{name: 'daily-scan'}],
      knowledge: [{name: 'api-docs'}],
    })),
    getInspectMcpManager: vi.fn(async () => undefined),
  } as unknown as SessionManager;
}

function createTestApp(sessionManager: SessionManager): express.Express {
  const app = express();
  app.use(createInspectRouter({sessionManager, repoPath: '/test/repo'}));
  return app;
}

describe('repo-inspect route', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = makeSessionManager();
  });

  it('should return repo context info', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('repo_path', '/test/repo');
    expect(res.body).toHaveProperty('name', 'test-agent');
    expect(res.body['connections']).toEqual([expect.objectContaining({name: 'crm'})]);
    expect(res.body['skills']).toEqual(['triage', 'investigate']);
    expect(res.body['automations']).toEqual(['daily-scan']);
    expect(res.body['knowledge']).toEqual(['api-docs']);
  });

  it('should handle missing repo', async () => {
    (sessionManager.getRepo as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const app = createTestApp(sessionManager);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(500);
    expect(res.body['error']['code']).toBe('INSPECT_FAILED');
  });
});
