/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createChatRouter} from './chat.js';
import type {AgentSessionManager} from '../session-manager.js';

// Mock agent-runner
vi.mock('../agent-runner.js', () => ({
  runAgentTurn: vi.fn(async function* () {
    yield {type: 'text_delta', content: 'Hello!', timestamp: new Date().toISOString()};
    yield {type: 'done', timestamp: new Date().toISOString()};
  }),
}));

function makeSessionManager(): AgentSessionManager {
  const sessions = new Map();

  return {
    size: 0,
    create: vi.fn(async (tenantId: string) => {
      const session = {
        id: 'session-1',
        tenantId,
        runtime: {compiledContext: {systemPrompt: 'test'}},
        conversationHistory: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        planModeManager: {},
        exploreConfig: {},
      };
      sessions.set(session.id, session);
      return session;
    }),
    get: vi.fn((id: string) => sessions.get(id)),
    destroy: vi.fn(),
    cleanup: vi.fn(),
    updateRepo: vi.fn(),
    shutdown: vi.fn(),
   
  } as unknown as AgentSessionManager;
}

function createTestApp(sessionManager: AgentSessionManager): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createChatRouter({sessionManager}));
  return app;
}

describe('repo-chat route', () => {
  let sessionManager: AgentSessionManager;

  beforeEach(() => {
    sessionManager = makeSessionManager();
  });

  it('should reject invalid request body', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).post('/chat').send({});
    expect(res.status).toBe(400);
  });

  it('should reject missing tenant_id', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).post('/chat').send({message: 'hello'});
    expect(res.status).toBe(400);
  });

  it('should return SSE events for valid request', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1'})
      .set('Accept', 'text/event-stream');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data:');
  });

  it('should create a new session if no session_id', async () => {
    const app = createTestApp(sessionManager);
    await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1'});

    expect(sessionManager.create).toHaveBeenCalledWith('tenant-1', undefined);
  });

  it('should reuse existing session if session_id provided', async () => {
    const app = createTestApp(sessionManager);

    // Create a session first
    await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1'});

    // Reuse it
    await request(app)
      .post('/chat')
      .send({message: 'follow up', tenant_id: 'tenant-1', session_id: 'session-1'});

    expect(sessionManager.get).toHaveBeenCalledWith('session-1');
  });

  it('should include init event in response', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1'});

    expect(res.text).toContain('"type":"init"');
  });

  it('should handle session creation failure', async () => {
     
    (sessionManager.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Setup failed'));

    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1'});

    expect(res.text).toContain('"type":"error"');
  });

  it('should pass tenant_token when provided', async () => {
    const app = createTestApp(sessionManager);
    await request(app)
      .post('/chat')
      .send({message: 'hello', tenant_id: 'tenant-1', tenant_token: 'tok-123'});

    expect(sessionManager.create).toHaveBeenCalledWith('tenant-1', 'tok-123');
  });
});
