/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { parseSSELine, streamChat, createSession, createChatClient } from '../client';
import { server } from '../test/mocks/server';
import { encodeSSEEvents, defaultSSEEvents, toolCallSSEEvents, skillAndKBSSEEvents } from '../test/mocks/handlers';

describe('parseSSELine', () => {
  it('parses a valid data line', () => {
    const result = parseSSELine('data: {"type":"text_delta","content":"hi","timestamp":"t1"}');
    expect(result).toEqual({ type: 'text_delta', content: 'hi', timestamp: 't1' });
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine(': comment')).toBeNull();
    expect(parseSSELine('')).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(parseSSELine('data: ')).toBeNull();
    expect(parseSSELine('data:   ')).toBeNull();
  });

  it('parses init events', () => {
    const result = parseSSELine('data: {"type":"init","session_id":"s1","timestamp":"t1"}');
    expect(result).toEqual({ type: 'init', session_id: 's1', timestamp: 't1' });
  });

  it('parses tool_call_start events', () => {
    const result = parseSSELine(
      'data: {"type":"tool_call_start","tool_id":"tc1","tool_name":"shell_exec","parameters":{"cmd":"ls"},"timestamp":"t1"}',
    );
    expect(result).toEqual({
      type: 'tool_call_start',
      tool_id: 'tc1',
      tool_name: 'shell_exec',
      parameters: { cmd: 'ls' },
      timestamp: 't1',
    });
  });

  it('parses skill_activated events', () => {
    const result = parseSSELine('data: {"type":"skill_activated","skill":"triage","timestamp":"t1"}');
    expect(result).toEqual({ type: 'skill_activated', skill: 'triage', timestamp: 't1' });
  });

  it('parses kb_proposal events', () => {
    const result = parseSSELine(
      'data: {"type":"kb_proposal","scope":"org","title":"Pattern","reasoning":"Found it","timestamp":"t1"}',
    );
    expect(result).toEqual({
      type: 'kb_proposal',
      scope: 'org',
      title: 'Pattern',
      reasoning: 'Found it',
      timestamp: 't1',
    });
  });
});

describe('streamChat', () => {
  it('streams default SSE events', async () => {
    const events = [];
    for await (const event of streamChat('http://localhost:4555', { message: 'hello' })) {
      events.push(event);
    }
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ type: 'init', session_id: 'test-session-1' });
    expect(events[1]).toMatchObject({ type: 'text_delta', content: 'Hello, ' });
    expect(events[2]).toMatchObject({ type: 'text_delta', content: 'world!' });
    expect(events[3]).toMatchObject({ type: 'done' });
  });

  it('streams tool call events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const events = [];
    for await (const event of streamChat('http://localhost:4555', { message: 'check zone' })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(true);
    expect(events.some((e) => e.type === 'tool_call_result')).toBe(true);
  });

  it('streams skill and KB proposal events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(skillAndKBSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const events = [];
    for await (const event of streamChat('http://localhost:4555', { message: 'investigate' })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'skill_activated')).toBe(true);
    expect(events.some((e) => e.type === 'kb_proposal')).toBe(true);
  });

  it('throws on non-OK response', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' }),
      ),
    );

    await expect(async () => {
      for await (const _event of streamChat('http://localhost:4555', { message: 'fail' })) {
        // should not reach
      }
    }).rejects.toThrow('Chat request failed: 500 Internal Server Error');
  });

  it('supports abort signal', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', async () => {
        // Simulate a slow response
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const controller = new AbortController();
    const promise = (async () => {
      const events = [];
      for await (const event of streamChat('http://localhost:4555', { message: 'slow' }, controller.signal)) {
        events.push(event);
      }
      return events;
    })();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toThrow();
  });

  it('passes session_id and role in request', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('http://localhost:4555/chat/stream', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    for await (const _event of streamChat('http://localhost:4555', {
      message: 'test',
      session_id: 'sid-1',
      role: 'analyst',
    })) {
      // consume
    }

    expect(capturedBody).toMatchObject({
      message: 'test',
      session_id: 'sid-1',
      role: 'analyst',
    });
  });
});

describe('createSession', () => {
  it('creates a session', async () => {
    const result = await createSession('http://localhost:4555', {
      id: 'analyst-1',
      role: 'analyst',
    });
    expect(result).toEqual({
      session_id: 'test-session-1',
      role: 'analyst',
    });
  });

  it('throws on server error', async () => {
    server.use(
      http.post('http://localhost:4555/sessions', () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    await expect(
      createSession('http://localhost:4555', { id: 'a', role: 'analyst' }),
    ).rejects.toThrow('Session creation failed');
  });
});

describe('createChatClient', () => {
  it('returns a client with stream and createSession methods', () => {
    const client = createChatClient('http://localhost:4555');
    expect(typeof client.stream).toBe('function');
    expect(typeof client.createSession).toBe('function');
  });

  it('client.stream works', async () => {
    const client = createChatClient('http://localhost:4555');
    const events = [];
    for await (const event of client.stream({ message: 'hi' })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });
});
