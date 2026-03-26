/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAskUserResponseRouter } from './ask-user-response.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ManagedSession } from '../session/session-manager.js';

function createMockSessionManager() {
  const sessions = new Map<string, ManagedSession>();
  const mockGet = vi.fn((id: string) => sessions.get(id));
  const mockResolveAskUser = vi.fn().mockReturnValue(true);

  return {
    manager: {
      get: mockGet,
      resolveAskUser: mockResolveAskUser,
    } as unknown as SessionManager,
    sessions,
    mockGet,
    mockResolveAskUser,
  };
}

function createApp(sessionManager: SessionManager) {
  const app = express();
  app.use(express.json());
  app.use(createAskUserResponseRouter({ sessionManager }));
  return app;
}

describe('ask-user-response route', () => {
  let mock: ReturnType<typeof createMockSessionManager>;
  let app: express.Express;

  beforeEach(() => {
    mock = createMockSessionManager();
    app = createApp(mock.manager);
    // Add a session
    mock.sessions.set('sess-1', {
      id: 'sess-1',
      pendingAskUser: new Map(),
    } as unknown as ManagedSession);
  });

  it('returns 400 for missing session_id', async () => {
    // This won't match the route pattern, so Express returns 404
    const res = await request(app)
      .post('/chat/sessions//ask-user-response')
      .send({ ask_id: 'a1', answers: {} });
    // Double-slash won't match Express route pattern
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/chat/sessions/sess-1/ask-user-response')
      .send({ bad: 'data' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('returns 400 for empty ask_id', async () => {
    const res = await request(app)
      .post('/chat/sessions/sess-1/ask-user-response')
      .send({ ask_id: '', answers: {} });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app)
      .post('/chat/sessions/no-such-session/ask-user-response')
      .send({ ask_id: 'a1', answers: { '0': 'yes' } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 404 when ask_id is not pending', async () => {
    mock.mockResolveAskUser.mockReturnValue(false);
    const res = await request(app)
      .post('/chat/sessions/sess-1/ask-user-response')
      .send({ ask_id: 'not-pending', answers: { '0': 'yes' } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ASK_NOT_FOUND');
  });

  it('resolves ask_user and returns ok', async () => {
    mock.mockResolveAskUser.mockReturnValue(true);
    const res = await request(app)
      .post('/chat/sessions/sess-1/ask-user-response')
      .send({ ask_id: 'ask-123', answers: { '0': 'yes', '1': 'Option A' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mock.mockResolveAskUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1' }),
      'ask-123',
      { '0': 'yes', '1': 'Option A' },
    );
  });
});
