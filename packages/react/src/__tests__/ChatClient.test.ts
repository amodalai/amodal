/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { ChatClient } from '../client/ChatClient';
import { encodeSSEEvents } from '../test/mocks/handlers';
import type { ToolExecutedEvent, SkillActivatedEvent, WidgetRenderedEvent, KBProposalEvent } from '../events/types';

const BASE_URL = 'http://localhost:4555';

function makeClient(): ChatClient {
  return new ChatClient({
    serverUrl: BASE_URL,
    user: { id: 'analyst-1', role: 'analyst' },
  });
}

describe('ChatClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect()', () => {
    it('establishes a session', async () => {
      const client = makeClient();
      await client.connect();

      expect(client.isConnected).toBe(true);
      expect(client.getSessionId()).toBe('test-session-1');
    });

    it('emits connected event', async () => {
      const client = makeClient();
      const handler = vi.fn();
      client.on('connected', handler);

      await client.connect();

      expect(handler).toHaveBeenCalled();
    });

    it('emits error event on failure', async () => {
      server.use(
        http.post(`${BASE_URL}/sessions`, () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );

      const client = makeClient();
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      await expect(client.connect()).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    it('clears session state', async () => {
      const client = makeClient();
      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.disconnect();
      expect(client.isConnected).toBe(false);
      expect(client.getSessionId()).toBeNull();
    });

    it('emits disconnected event', async () => {
      const client = makeClient();
      await client.connect();

      const handler = vi.fn();
      client.on('disconnected', handler);
      await client.disconnect();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('auto-connects if not connected', async () => {
      const client = makeClient();
      expect(client.isConnected).toBe(false);

      // Set up stream response
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Hello', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const response = await client.send('hi');
      expect(client.isConnected).toBe(true);
      expect(response.text).toBe('Hello');
    });

    it('returns ChatResponse with text', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Part 1 ', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Part 2', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      const response = await client.send('test');

      expect(response.text).toBe('Part 1 Part 2');
      expect(response.toolCalls).toEqual([]);
      expect(response.skillsUsed).toEqual([]);
      expect(response.kbProposals).toEqual([]);
    });
  });

  describe('messages', () => {
    it('messages getter returns history', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Reply', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      await client.send('hello');

      // Should have user message + assistant message
      expect(client.messages.length).toBe(2);
      expect(client.messages[0].type).toBe('user');
      expect(client.messages[1].type).toBe('assistant_text');
    });

    it('clearHistory() empties messages', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Hi', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      await client.send('hello');
      expect(client.messages.length).toBeGreaterThan(0);

      client.clearHistory();
      expect(client.messages.length).toBe(0);
    });
  });

  describe('isConnected', () => {
    it('reflects connection state', async () => {
      const client = makeClient();
      expect(client.isConnected).toBe(false);

      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });

  describe('isStreaming', () => {
    it('is false initially', () => {
      const client = makeClient();
      expect(client.isStreaming).toBe(false);
    });

    it('is false after send completes', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Done', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      await client.send('test');
      expect(client.isStreaming).toBe(false);
    });
  });

  describe('stream()', () => {
    it('returns a ChatStream', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'text_delta', content: 'Streaming...', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      await client.connect();

      const stream = client.stream('test');

      // ChatStream should have .on() and .abort() methods
      expect(typeof stream.on).toBe('function');
      expect(typeof stream.abort).toBe('function');
    });
  });

  describe('events', () => {
    it('exposes events getter (WidgetEventBus)', () => {
      const client = makeClient();
      expect(client.events).toBeDefined();
      expect(typeof client.events.on).toBe('function');
      expect(typeof client.events.processEvent).toBe('function');
    });

    it('emits tool_executed event on send with tool call', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'tool_call_start', tool_id: 'tc-1', tool_name: 'shell_exec', parameters: { cmd: 'ls' }, timestamp: new Date().toISOString() },
              { type: 'tool_call_result', tool_id: 'tc-1', status: 'success', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      const toolHandler = vi.fn();
      client.on('tool_executed', toolHandler);

      await client.send('test');

      expect(toolHandler).toHaveBeenCalledTimes(1);
      const event = toolHandler.mock.calls[0][0] as ToolExecutedEvent;
      expect(event.type).toBe('tool_executed');
      expect(event.toolName).toBe('shell_exec');
      expect(event.parameters).toEqual({ cmd: 'ls' });
    });

    it('emits skill_activated and kb_proposal_received events', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'skill_activated', skill: 'triage', timestamp: new Date().toISOString() },
              { type: 'kb_proposal', scope: 'org', title: 'New pattern', reasoning: 'Found it', timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      const skillHandler = vi.fn();
      const kbHandler = vi.fn();
      client.on('skill_activated', skillHandler);
      client.on('kb_proposal_received', kbHandler);

      await client.send('investigate');

      expect(skillHandler).toHaveBeenCalledTimes(1);
      expect((skillHandler.mock.calls[0][0] as SkillActivatedEvent).skill).toBe('triage');
      expect(kbHandler).toHaveBeenCalledTimes(1);
      expect((kbHandler.mock.calls[0][0] as KBProposalEvent).proposal.title).toBe('New pattern');
    });

    it('emits widget_rendered event and entity_referenced via bus', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'widget', widget_type: 'entity-card', data: { mac: 'AA:BB:CC:DD:EE:01', zone: 'A' }, timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const client = makeClient();
      const widgetHandler = vi.fn();
      const entityHandler = vi.fn();
      client.on('widget_rendered', widgetHandler);
      client.on('entity_referenced', entityHandler);

      await client.send('show device');

      expect(widgetHandler).toHaveBeenCalledTimes(1);
      const event = widgetHandler.mock.calls[0][0] as WidgetRenderedEvent;
      expect(event.widgetType).toBe('entity-card');

      // Entity extractor should have found device + zone
      expect(entityHandler).toHaveBeenCalledTimes(2);
    });

    it('supports custom entity extractors via config', async () => {
      server.use(
        http.post(`${BASE_URL}/chat/stream`, () =>
          new HttpResponse(
            encodeSSEEvents([
              { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
              { type: 'widget', widget_type: 'custom', data: { id: 'c-1' }, timestamp: new Date().toISOString() },
              { type: 'done', timestamp: new Date().toISOString() },
            ]),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );

      const customExtractor = vi.fn().mockReturnValue([
        { entityType: 'custom', entityId: 'c-1', source: 'custom' },
      ]);

      const client = new ChatClient({
        serverUrl: BASE_URL,
        user: { id: 'analyst-1', role: 'analyst' },
        entityExtractors: [customExtractor],
      });

      const entityHandler = vi.fn();
      client.on('entity_referenced', entityHandler);

      await client.send('test');

      expect(customExtractor).toHaveBeenCalled();
      expect(entityHandler).toHaveBeenCalledTimes(1);
    });
  });
});
