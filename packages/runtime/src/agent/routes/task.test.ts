/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createTaskRouter} from './task.js';
import type {TaskRouterOptions} from './task.js';
import {SSEEventType} from '../../types.js';
import {createLogger} from '../../logger.js';

const logger = createLogger({component: 'test:task'});

const mockSession = {
  id: 'task-session-1',
  provider: {},
  toolRegistry: {register: vi.fn(), get: vi.fn(), getTools: vi.fn(), names: vi.fn(() => []), subset: vi.fn(), size: 0},
  permissionChecker: {check: vi.fn()},
  logger,
  systemPrompt: 'test',
  messages: [],
  usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
  model: 'test-model',
  providerName: 'test',
  userRoles: [],
  appId: 'local',
  metadata: {},
  createdAt: Date.now(),
  lastAccessedAt: Date.now(),
  maxTurns: 50,
  maxContextTokens: 200_000,
};

function makeOpts(): TaskRouterOptions {
  const runMessage = vi.fn().mockImplementation(async function* () {
    yield {type: SSEEventType.TextDelta, content: 'Task output', timestamp: new Date().toISOString()};
    yield {type: SSEEventType.Done, timestamp: new Date().toISOString()};
  });

   
  return {
    sessionManager: {
      create: vi.fn().mockReturnValue(mockSession),
      runMessage,
      destroy: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      resume: vi.fn(),
      persist: vi.fn(),
      listPersisted: vi.fn(),
      start: vi.fn(),
      shutdown: vi.fn(),
      cleanup: vi.fn(),
      size: 0,
    } as unknown as TaskRouterOptions['sessionManager'],
    createTaskSession: vi.fn().mockReturnValue({
      session: mockSession,
      toolContextFactory: vi.fn(),
    }),
  };
}

function createTestApp(opts: TaskRouterOptions): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createTaskRouter(opts));
  return app;
}

describe('repo-task route', () => {
  let opts: TaskRouterOptions;

  beforeEach(() => {
    opts = makeOpts();
  });

  it('should reject invalid request', async () => {
    const app = createTestApp(opts);
    const res = await request(app).post('/task').send({});
    expect(res.status).toBe(400);
  });

  it('should accept valid request and return task ID', async () => {
    const app = createTestApp(opts);
    const res = await request(app).post('/task').send({prompt: 'Run diagnostics'});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('task_id');
  });

  it('should return 404 for unknown task', async () => {
    const app = createTestApp(opts);
    const res = await request(app).get('/task/unknown-id');
    expect(res.status).toBe(404);
  });

  it('should return task status after creation', async () => {
    const app = createTestApp(opts);
    const createRes = await request(app).post('/task').send({prompt: 'Run diagnostics'});
    const taskId = createRes.body.task_id as string;

    // Wait briefly for background execution
    await new Promise((r) => setTimeout(r, 50));

    const statusRes = await request(app).get(`/task/${taskId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.task_id).toBe(taskId);
  });

  it('should stream task events', async () => {
    const app = createTestApp(opts);
    const createRes = await request(app).post('/task').send({prompt: 'Run diagnostics'});
    const taskId = createRes.body.task_id as string;

    // Wait for completion
    await new Promise((r) => setTimeout(r, 100));

    const streamRes = await request(app).get(`/task/${taskId}/stream`);
    expect(streamRes.status).toBe(200);
    expect(streamRes.text).toContain('data:');
  });
});
