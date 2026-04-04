/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createChatRouter } from './chat-legacy.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock session runner
const mockRunMessage = vi.fn();
vi.mock('../session/session-runner.js', () => ({
  runMessage: (...args: unknown[]) => mockRunMessage(...args),
}));

function createApp(sessionManager: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use(createChatRouter({ sessionManager: sessionManager as never }));
  app.use(errorHandler);
  return app;
}

describe('POST /chat', () => {
  const mockCreate = vi.fn();
  const mockGet = vi.fn();
  let sessionManager: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunMessage.mockResolvedValue({
      session_id: 'sess-1',
      response: 'Hello!',
      tool_calls: [],
    });
    mockCreate.mockResolvedValue({
      id: 'sess-1',
      config: {},
      geminiClient: {},
      scheduler: {},
    });
    sessionManager = {
      create: mockCreate,
      get: mockGet,
    };
  });

  it('creates a new session and returns response', async () => {
    const app = createApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({ message: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe('sess-1');
    expect(res.body.response).toBe('Hello!');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockRunMessage).toHaveBeenCalledOnce();
  });

  it('reuses existing session when session_id provided', async () => {
    const existingSession = { id: 'sess-existing' };
    mockGet.mockReturnValue(existingSession);

    const app = createApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({ message: 'hi', session_id: 'sess-existing' });

    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith('sess-existing');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown session_id', async () => {
    mockGet.mockReturnValue(undefined);

    const app = createApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({ message: 'hi', session_id: 'nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 400 for missing message', async () => {
    const app = createApp(sessionManager);
    const res = await request(app).post('/chat').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('passes role to session create', async () => {
    const app = createApp(sessionManager);
    await request(app)
      .post('/chat')
      .send({ message: 'hello', role: 'analyst' });

    expect(mockCreate).toHaveBeenCalledWith('analyst', undefined, undefined, undefined, undefined);
  });

  it('returns 500 on internal error', async () => {
    mockRunMessage.mockRejectedValue(new Error('LLM broke'));

    const app = createApp(sessionManager);
    const res = await request(app)
      .post('/chat')
      .send({ message: 'hello' });

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('LLM broke');
  });
});
