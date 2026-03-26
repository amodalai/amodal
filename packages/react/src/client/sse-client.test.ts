/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { parseSSELine, streamSSE, streamSSEGet } from './sse-client';

describe('parseSSELine', () => {
  it('parses a valid data line', () => {
    const event = parseSSELine('data: {"type":"text_delta","content":"hi","timestamp":"2025-01-01T00:00:00Z"}');
    expect(event).toEqual({
      type: 'text_delta',
      content: 'hi',
      timestamp: '2025-01-01T00:00:00Z',
    });
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine(': comment')).toBeNull();
    expect(parseSSELine('')).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(parseSSELine('data: ')).toBeNull();
    expect(parseSSELine('data:    ')).toBeNull();
  });

  it('parses init event', () => {
    const event = parseSSELine('data: {"type":"init","session_id":"abc","timestamp":"2025-01-01T00:00:00Z"}');
    expect(event).toEqual({
      type: 'init',
      session_id: 'abc',
      timestamp: '2025-01-01T00:00:00Z',
    });
  });
});

describe('streamSSE', () => {
  it('yields events from POST endpoint', async () => {
    const events = [];
    for await (const event of streamSSE(`${RUNTIME_TEST_URL}/chat`, { message: 'hello', tenant_id: 't1' })) {
      events.push(event);
    }
    expect(events.length).toBe(4);
    expect(events[0]).toMatchObject({ type: 'init', session_id: 'test-session-1' });
    expect(events[3]).toMatchObject({ type: 'done' });
  });

  it('throws on non-ok response', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const gen = streamSSE(`${RUNTIME_TEST_URL}/chat`, { message: 'hello', tenant_id: 't1' });
    await expect(gen.next()).rejects.toThrow('SSE request failed: 500');
  });

  it('passes custom headers', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return new HttpResponse(encodeSSEEvents([{ type: 'done', timestamp: '' }]), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const events = [];
    for await (const event of streamSSE(`${RUNTIME_TEST_URL}/chat`, { message: 'hi', tenant_id: 't1' }, { headers: { 'Authorization': 'Bearer tok' } })) {
      events.push(event);
    }
    expect(capturedAuth).toBe('Bearer tok');
  });
});

describe('streamSSEGet', () => {
  it('yields events from GET endpoint', async () => {
    const events = [];
    for await (const event of streamSSEGet(`${RUNTIME_TEST_URL}/task/task-1/stream`)) {
      events.push(event);
    }
    expect(events.length).toBe(4);
    expect(events[0]).toMatchObject({ type: 'init' });
  });
});
