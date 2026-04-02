/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createChatRouter} from './chat.js';
import type {SessionManager} from '../../session/session-manager.js';

// Mock session-runner
vi.mock('../../session/session-runner.js', () => ({
  streamMessage: vi.fn(async function* () {
    yield {type: 'text_delta', content: 'Hello!', timestamp: new Date().toISOString()};
    yield {type: 'done', timestamp: new Date().toISOString()};
  }),
}));

function makeSessionManager(): SessionManager {
  const sessions = new Map();

  return {
    size: 0,
    create: vi.fn(async () => {
      const session = {
        id: 'session-1',
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

  } as unknown as SessionManager;
}

function createTestApp(sessionManager: SessionManager): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createChatRouter({sessionManager}));
  return app;
}

describe('repo-chat route', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = makeSessionManager();
  });

  it('should reject invalid request body', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app).post('/chat').send({});
    expect(res.status).toBe(400);
  });

  it('should accept request without app_id', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello'})
      .set('Accept', 'text/event-stream');

    expect(res.status).toBe(200);
  });

  it('should return SSE events for valid request', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello'})
      .set('Accept', 'text/event-stream');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data:');
  });

  it('should create a new session if no session_id', async () => {
    const app = createTestApp(sessionManager);
    await request(app)
      .post('/chat')
      .send({message: 'hello'});

    expect(sessionManager.create).toHaveBeenCalled();
  });

  it('should reuse existing session if session_id provided', async () => {
    const app = createTestApp(sessionManager);

    // Create a session first
    await request(app)
      .post('/chat')
      .send({message: 'hello'});

    // Reuse it
    await request(app)
      .post('/chat')
      .send({message: 'follow up', session_id: 'session-1'});

    expect(sessionManager.get).toHaveBeenCalledWith('session-1');
  });

  it('should include init event in response', async () => {
    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello'});

    expect(res.text).toContain('"type":"init"');
  });

  it('should handle session creation failure', async () => {

    (sessionManager.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Setup failed'));

    const app = createTestApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({message: 'hello'});

    expect(res.text).toContain('"type":"error"');
  });
});
