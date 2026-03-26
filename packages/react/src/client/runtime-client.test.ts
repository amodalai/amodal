/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { RuntimeClient } from './runtime-client';

function createClient(getToken?: () => string | Promise<string> | null | undefined) {
  return new RuntimeClient({
    runtimeUrl: RUNTIME_TEST_URL,
    tenantId: 'tenant-1',
    getToken,
  });
}

describe('RuntimeClient', () => {
  describe('chatStream', () => {
    it('streams chat events', async () => {
      const client = createClient();
      const events = [];
      for await (const event of client.chatStream('hello')) {
        events.push(event);
      }
      expect(events.length).toBe(4);
      expect(events[0]).toMatchObject({ type: 'init' });
      expect(events[3]).toMatchObject({ type: 'done' });
    });

    it('sends tenant_id in body', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/chat`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return new HttpResponse(encodeSSEEvents([{ type: 'done', timestamp: '' }]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const client = createClient();
      const events = [];
      for await (const event of client.chatStream('hi')) {
        events.push(event);
      }
      expect(capturedBody).toMatchObject({ message: 'hi', tenant_id: 'tenant-1' });
    });

    it('includes session_id and context when provided', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/chat`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return new HttpResponse(encodeSSEEvents([{ type: 'done', timestamp: '' }]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const client = createClient();
      const events = [];
      for await (const event of client.chatStream('hi', { sessionId: 'sess-1', context: { foo: 'bar' } })) {
        events.push(event);
      }
      expect(capturedBody).toMatchObject({
        message: 'hi',
        tenant_id: 'tenant-1',
        session_id: 'sess-1',
        context: { foo: 'bar' },
      });
    });

    it('sends auth header from async getToken', async () => {
      let capturedAuth: string | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/chat`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization');
          return new HttpResponse(encodeSSEEvents([{ type: 'done', timestamp: '' }]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const client = createClient(async () => 'my-token');
      const events = [];
      for await (const event of client.chatStream('hi')) {
        events.push(event);
      }
      expect(capturedAuth).toBe('Bearer my-token');
    });

    it('can be aborted', async () => {
      server.use(
        http.post(`${RUNTIME_TEST_URL}/chat`, () =>
          new HttpResponse(encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: 'long response...', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const client = createClient();
      const controller = new AbortController();
      const events = [];
      for await (const event of client.chatStream('hi', { signal: controller.signal })) {
        events.push(event);
        if (event.type === 'init') {
          controller.abort();
          break;
        }
      }
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('startTask', () => {
    it('returns task_id', async () => {
      const client = createClient();
      const result = await client.startTask('analyze data');
      expect(result).toEqual({ task_id: 'task-1' });
    });

    it('sends tenant_id in body', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/task`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({ task_id: 'task-2' }, { status: 202 });
        }),
      );

      const client = createClient();
      await client.startTask('do thing');
      expect(capturedBody).toMatchObject({ prompt: 'do thing', tenant_id: 'tenant-1' });
    });

    it('includes tenant_token when provided', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/task`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({ task_id: 'task-3' }, { status: 202 });
        }),
      );

      const client = createClient();
      await client.startTask('do thing', 'tok-123');
      expect(capturedBody).toMatchObject({ prompt: 'do thing', tenant_id: 'tenant-1', tenant_token: 'tok-123' });
    });

    it('throws on error response', async () => {
      server.use(
        http.post(`${RUNTIME_TEST_URL}/task`, () =>
          new HttpResponse(null, { status: 400 }),
        ),
      );

      const client = createClient();
      await expect(client.startTask('bad')).rejects.toThrow('Start task failed');
    });
  });

  describe('getTaskStatus', () => {
    it('returns task status', async () => {
      const client = createClient();
      const status = await client.getTaskStatus('task-1');
      expect(status).toMatchObject({ task_id: 'task-1', status: 'completed' });
    });

    it('throws on 404', async () => {
      server.use(
        http.get(`${RUNTIME_TEST_URL}/task/no-such-task`, () =>
          new HttpResponse(null, { status: 404 }),
        ),
      );

      const client = createClient();
      await expect(client.getTaskStatus('no-such-task')).rejects.toThrow('Get task status failed');
    });

    it('sends auth header', async () => {
      let capturedAuth: string | null = null;
      server.use(
        http.get(`${RUNTIME_TEST_URL}/task/task-1`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization');
          return HttpResponse.json({ task_id: 'task-1', status: 'running', event_count: 0, created_at: 0 });
        }),
      );

      const client = createClient(() => 'secret');
      await client.getTaskStatus('task-1');
      expect(capturedAuth).toBe('Bearer secret');
    });
  });

  describe('streamTask', () => {
    it('streams task events', async () => {
      const client = createClient();
      const events = [];
      for await (const event of client.streamTask('task-1')) {
        events.push(event);
      }
      expect(events.length).toBe(4);
    });
  });

  describe('URL handling', () => {
    it('strips trailing slash from runtimeUrl', async () => {
      const client = new RuntimeClient({
        runtimeUrl: `${RUNTIME_TEST_URL}/`,
        tenantId: 'tenant-1',
      });

      const events = [];
      for await (const event of client.chatStream('hello')) {
        events.push(event);
      }
      expect(events.length).toBe(4);
    });

    it('handles sync getToken returning null', async () => {
      const getToken = vi.fn(() => null);
      let capturedAuth: string | null = null;
      server.use(
        http.post(`${RUNTIME_TEST_URL}/chat`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization');
          return new HttpResponse(encodeSSEEvents([{ type: 'done', timestamp: '' }]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const client = createClient(getToken);
      const events = [];
      for await (const event of client.chatStream('hi')) {
        events.push(event);
      }
      expect(capturedAuth).toBeNull();
    });
  });
});
