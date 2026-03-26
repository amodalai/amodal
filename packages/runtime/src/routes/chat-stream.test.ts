/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createChatStreamRouter } from './chat-stream.js';
import { errorHandler } from '../middleware/error-handler.js';
import { SSEEventType } from '../types.js';

// Mock session runner
const mockStreamMessage = vi.fn();
vi.mock('../session/session-runner.js', () => ({
  streamMessage: (...args: unknown[]) => mockStreamMessage(...args),
}));

function createApp(sessionManager: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use(createChatStreamRouter({ sessionManager: sessionManager as never }));
  app.use(errorHandler);
  return app;
}

async function* makeEvents(
  events: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) {
    yield event;
  }
}

describe('POST /chat/stream', () => {
  const mockCreate = vi.fn();
  const mockGet = vi.fn();
  const mockHydrate = vi.fn();
  let sessionManager: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      id: 'sess-1',
      config: {},
      geminiClient: {},
      scheduler: {},
    });
    mockHydrate.mockResolvedValue(null);
    sessionManager = {
      create: mockCreate,
      get: mockGet,
      hydrate: mockHydrate,
    };
  });

  it('returns SSE content type', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        {
          type: SSEEventType.Init,
          session_id: 'sess-1',
          timestamp: new Date().toISOString(),
        },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({ message: 'hello' });

    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('sends SSE events in the response body', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        {
          type: SSEEventType.Init,
          session_id: 'sess-1',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          type: SSEEventType.TextDelta,
          content: 'Hello!',
          timestamp: '2024-01-01T00:00:01Z',
        },
        { type: SSEEventType.Done, timestamp: '2024-01-01T00:00:02Z' },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({ message: 'hello' });

    // Parse SSE events from response text
    const lines = res.text.split('\n\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Each line should start with "data: "
    for (const line of lines) {
      expect(line.startsWith('data: ')).toBe(true);
      const json = JSON.parse(line.replace('data: ', ''));
      expect(json.type).toBeDefined();
    }
  });

  it('hydrates expired session when session_id not in memory', async () => {
    mockGet.mockReturnValue(undefined);
    const hydratedSession = {
      id: 'old-conv',
      config: {},
      geminiClient: {},
      scheduler: {},
    };
    mockHydrate.mockResolvedValue(hydratedSession);
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'old-conv', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({ message: 'hi', session_id: 'old-conv' });

    expect(res.status).toBe(200);
    expect(mockHydrate).toHaveBeenCalledWith('old-conv', undefined, undefined, undefined);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('falls back to fresh session when hydration fails', async () => {
    mockGet.mockReturnValue(undefined);
    mockHydrate.mockResolvedValue(null);
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({ message: 'hi', session_id: 'nonexistent' });

    expect(res.status).toBe(200);
    expect(mockHydrate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('streams normally after hydration', async () => {
    mockGet.mockReturnValue(undefined);
    const hydratedSession = {
      id: 'hydrated-conv',
      config: {},
      geminiClient: {},
      scheduler: {},
    };
    mockHydrate.mockResolvedValue(hydratedSession);
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'hydrated-conv', timestamp: '2024-01-01T00:00:00Z' },
        { type: SSEEventType.TextDelta, content: 'Continued response', timestamp: '2024-01-01T00:00:01Z' },
        { type: SSEEventType.Done, timestamp: '2024-01-01T00:00:02Z' },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({ message: 'continue', session_id: 'hydrated-conv' });

    expect(res.status).toBe(200);
    const lines = res.text.split('\n\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Verify the stream contains the hydrated session's events
    const initEvent = JSON.parse(lines[0].replace('data: ', ''));
    expect(initEvent.session_id).toBe('hydrated-conv');
  });

  it('returns 400 for missing message', async () => {
    const res = await request(createApp(sessionManager))
      .post('/chat/stream')
      .send({});

    expect(res.status).toBe(400);
  });
});
