/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createInspectRouter} from './inspect.js';
import type {AgentSessionManager} from '../session-manager.js';

function makeSessionManager(): AgentSessionManager {
  return {
    size: 0,
    create: vi.fn(async () => ({
      id: 'inspect-session',
      tenantId: '__inspect__',
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
          connections: new Map([['crm', {}]]),
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
   
  } as unknown as AgentSessionManager;
}

function createTestApp(sessionManager: AgentSessionManager): express.Express {
  const app = express();
  app.use(createInspectRouter({sessionManager, repoPath: '/test/repo'}));
  return app;
}

describe('repo-inspect route', () => {
  let sessionManager: AgentSessionManager;

  beforeEach(() => {
    sessionManager = makeSessionManager();
  });

  it('should return compiled context info', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('repo_path', '/test/repo');
    expect(res.body['token_usage']).toEqual({
      total: 100000,
      used: 500,
      remaining: 99500,
      sectionBreakdown: {core: 200, skills: 300},
    });
    expect(res.body['sections']).toHaveLength(2);
    expect(res.body['connections']).toEqual(['crm']);
    expect(res.body['skills']).toEqual(['triage', 'investigate']);
    expect(res.body['automations']).toEqual(['daily-scan']);
    expect(res.body['knowledge']).toEqual(['api-docs']);
  });

  it('should destroy temporary session after inspect', async () => {
    const app = createTestApp(sessionManager);
    await request(app).get('/inspect/context');

    expect(sessionManager.destroy).toHaveBeenCalledWith('inspect-session');
  });

  it('should handle session creation errors', async () => {
     
    (sessionManager.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Config invalid'));

    const app = createTestApp(sessionManager);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(500);
    expect(res.body['error']['code']).toBe('INSPECT_FAILED');
  });
});
