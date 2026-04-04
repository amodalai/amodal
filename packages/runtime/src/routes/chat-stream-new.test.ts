/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the new chat-stream route.
 *
 * Mocks resolveSession and StandaloneSessionManager.runMessage to verify
 * the route wiring: SSE format, hooks adaptation, error handling.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createChatStreamRouter} from './chat-stream.js';
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

function stubFactory() {
  return vi.fn();
}

async function* makeEvents(events: SSEEvent[]): AsyncGenerator<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

function createApp(overrides: Record<string, unknown> = {}) {
  const mockRunMessage = vi.fn();
  const sessionManager = {runMessage: mockRunMessage, persist: vi.fn().mockResolvedValue(undefined), ...overrides};

  const app = express();
  app.use(express.json());
  app.use(createChatStreamRouter({
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

describe('POST /chat/stream (new route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns SSE content type and streams events', async () => {
    const factory = stubFactory();
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: factory});

    const {app, mockRunMessage} = createApp();
    mockRunMessage.mockReturnValue(
      makeEvents([
        {type: SSEEventType.Init, session_id: 'sess-1', timestamp: '2024-01-01T00:00:00Z'} as SSEEvent,
        {type: SSEEventType.TextDelta, content: 'Hello!', timestamp: '2024-01-01T00:00:01Z'} as SSEEvent,
        {type: SSEEventType.Done, timestamp: '2024-01-01T00:00:02Z'} as SSEEvent,
      ]),
    );

    const res = await request(app)
      .post('/chat/stream')
      .send({message: 'hello'});

    expect(res.headers['content-type']).toContain('text/event-stream');
    const lines = res.text.split('\n\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line.startsWith('data: ')).toBe(true);
    }
  });

  it('passes toolContextFactory as buildToolContext to runMessage', async () => {
    const factory = stubFactory();
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: factory});

    const {app, mockRunMessage} = createApp();
    mockRunMessage.mockReturnValue(makeEvents([
      {type: SSEEventType.Done, timestamp: '2024-01-01T00:00:00Z'} as SSEEvent,
    ]));

    await request(app)
      .post('/chat/stream')
      .send({message: 'hello'});

    expect(mockRunMessage).toHaveBeenCalledWith(
      'sess-1',
      'hello',
      expect.objectContaining({buildToolContext: factory}),
    );
  });

  it('fires onAuditLog hook after stream drains', async () => {
    const factory = stubFactory();
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: factory});

    const onAuditLog = vi.fn();
    const mockRunMessage = vi.fn().mockReturnValue(makeEvents([
      {type: SSEEventType.ToolCallStart, tool_name: 'request', tool_id: 'tc-1', parameters: {}, timestamp: ''} as SSEEvent,
      {type: SSEEventType.ToolCallResult, tool_id: 'tc-1', status: 'success', timestamp: ''} as SSEEvent,
      {type: SSEEventType.Done, timestamp: ''} as SSEEvent,
    ]));

    const app = express();
    app.use(express.json());
    app.use(createChatStreamRouter({
      sessionManager: {runMessage: mockRunMessage, persist: vi.fn().mockResolvedValue(undefined)} as never,
      bundleResolver: {},
      shared: {storeBackend: null, mcpManager: null, logger: {} as never},
      createStreamHooks: () => ({onAuditLog}),
    }));

    await request(app).post('/chat/stream').send({message: 'test'});

    expect(onAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'session_completed',
        details: expect.objectContaining({
          tool_calls: [{tool_name: 'request', tool_id: 'tc-1', status: 'success'}],
        }),
      }),
    );
  });

  it('writes SSE error event when handler throws after headers sent', async () => {
    mockResolveSession.mockResolvedValue({session: stubSession(), toolContextFactory: stubFactory()});

    const mockRunMessage = vi.fn().mockImplementation(function* () {
      yield {type: SSEEventType.Init, session_id: 'sess-1', timestamp: ''};
      throw new Error('mid-stream failure');
    });

    const app = express();
    app.use(express.json());
    app.use(createChatStreamRouter({
      sessionManager: {runMessage: mockRunMessage, persist: vi.fn().mockResolvedValue(undefined)} as never,
      bundleResolver: {},
      shared: {storeBackend: null, mcpManager: null, logger: {} as never},
    }));

    const res = await request(app).post('/chat/stream').send({message: 'hello'});

    expect(res.status).toBe(200);
    expect(res.text).toContain(SSEEventType.Error);
    expect(res.text).toContain('mid-stream failure');
  });
});
