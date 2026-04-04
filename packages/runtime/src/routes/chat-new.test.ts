/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the new non-streaming chat route (Phase 3.5c).
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createChatRouter} from './chat.js';
import {errorHandler} from '../middleware/error-handler.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockResolveSession = vi.fn();
vi.mock('./session-resolver.js', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
}));

function stubSession(id = 'sess-1') {
  return {
    id,
    model: 'test-model',
    providerName: 'test-provider',
  };
}

async function* makeEvents(events: SSEEvent[]): AsyncGenerator<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

function createApp() {
  const mockRunMessage = vi.fn();
  const sessionManager = {runMessage: mockRunMessage};

  const app = express();
  app.use(express.json());
  app.use(createChatRouter({
    sessionManager: sessionManager as never,
    bundleResolver: {},
    shared: {storeBackend: null, mcpManager: null, logger: {} as never},
  }));
  app.use(errorHandler);

  return {app, mockRunMessage};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /chat/sync (new route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns JSON with session_id, response, and tool_calls', async () => {
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: vi.fn()});

    const {app, mockRunMessage} = createApp();
    mockRunMessage.mockReturnValue(
      makeEvents([
        {type: SSEEventType.Init, session_id: 'sess-1', timestamp: ''} as SSEEvent,
        {type: SSEEventType.TextDelta, content: 'Hello ', timestamp: ''} as SSEEvent,
        {type: SSEEventType.TextDelta, content: 'world!', timestamp: ''} as SSEEvent,
        {type: SSEEventType.Done, timestamp: ''} as SSEEvent,
      ]),
    );

    const res = await request(app)
      .post('/chat/sync')
      .send({message: 'hello'});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      session_id: 'sess-1',
      response: 'Hello world!',
      tool_calls: [],
    });
  });

  it('collects tool calls from SSE events', async () => {
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: vi.fn()});

    const {app, mockRunMessage} = createApp();
    mockRunMessage.mockReturnValue(
      makeEvents([
        {type: SSEEventType.ToolCallStart, tool_name: 'request', tool_id: 'tc-1', parameters: {}, timestamp: ''} as SSEEvent,
        {type: SSEEventType.ToolCallResult, tool_id: 'tc-1', status: 'success', timestamp: ''} as SSEEvent,
        {type: SSEEventType.ToolCallStart, tool_name: 'store_write', tool_id: 'tc-2', parameters: {}, timestamp: ''} as SSEEvent,
        {type: SSEEventType.ToolCallResult, tool_id: 'tc-2', status: 'error', error: 'Store unavailable', timestamp: ''} as SSEEvent,
        {type: SSEEventType.Done, timestamp: ''} as SSEEvent,
      ]),
    );

    const res = await request(app)
      .post('/chat/sync')
      .send({message: 'do things'});

    expect(res.body.tool_calls).toEqual([
      {tool_name: 'request', tool_id: 'tc-1', status: 'success', error: undefined},
      {tool_name: 'store_write', tool_id: 'tc-2', status: 'error', error: 'Store unavailable'},
    ]);
  });

  it('returns 400 for missing message', async () => {
    const {app} = createApp();
    const res = await request(app)
      .post('/chat/sync')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 500 on resolveSession error', async () => {
    mockResolveSession.mockRejectedValue(new Error('Bundle not found'));

    const {app} = createApp();
    const res = await request(app)
      .post('/chat/sync')
      .send({message: 'hello'});

    expect(res.status).toBe(500);
  });
});
