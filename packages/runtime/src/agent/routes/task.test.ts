/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createTaskRouter} from './task.js';
import type {SessionManager} from '../../session/session-manager.js';

// Mock agent-runner
vi.mock('../agent-runner.js', () => ({
  runAgentTurn: vi.fn(async function* () {
    yield {type: 'text_delta', content: 'Task output', timestamp: new Date().toISOString()};
    yield {type: 'done', timestamp: new Date().toISOString()};
  }),
}));

function makeSessionManager(): SessionManager {
  return {
    size: 0,
    create: vi.fn(async () => ({
      id: 'session-1',
      appId: 'tenant-1',
      runtime: {compiledContext: {systemPrompt: 'test'}},
      conversationHistory: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      planModeManager: {},
      exploreConfig: {},
    })),
    get: vi.fn(),
    destroy: vi.fn(),
    cleanup: vi.fn(),
    updateRepo: vi.fn(),
    shutdown: vi.fn(),
   
  } as unknown as SessionManager;
}

function createTestApp(sessionManager: SessionManager): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createTaskRouter({sessionManager}));
  return app;
}

describe('repo-task route', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = makeSessionManager();
  });

  it('should reject invalid request', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).post('/task').send({});
    expect(res.status).toBe(400);
  });

  it('should accept and return task_id', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/task')
      .send({prompt: 'do something', app_id: 'tenant-1'});

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('task_id');
  });

  it('should return 404 for unknown task', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).get('/task/nonexistent');
    expect(res.status).toBe(404);
  });

  it('should return task status after creation', async () => {
    const app = createTestApp(sessionManager);

    const createRes = await request(app)
      .post('/task')
      .send({prompt: 'do something', app_id: 'tenant-1'});

    const taskId = createRes.body['task_id'] as string;

    // Give the background task a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const statusRes = await request(app).get(`/task/${taskId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toHaveProperty('task_id', taskId);
    expect(statusRes.body).toHaveProperty('status');
  });

  it('should stream task events', async () => {
    const app = createTestApp(sessionManager);

    const createRes = await request(app)
      .post('/task')
      .send({prompt: 'do something', app_id: 'tenant-1'});

    const taskId = createRes.body['task_id'] as string;

    // Give the background task a moment
    await new Promise((resolve) => setTimeout(resolve, 100));

    const streamRes = await request(app).get(`/task/${taskId}/stream`);
    expect(streamRes.status).toBe(200);
  });
});
