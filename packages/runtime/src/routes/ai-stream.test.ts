/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAIStreamRouter } from './ai-stream-legacy.js';
import { translateEvent, extractUserMessage } from './ai-stream.js';
import { errorHandler } from '../middleware/error-handler.js';
import { SSEEventType } from '../types.js';
import type { SSEEvent } from '../types.js';

// Mock session runner
const mockStreamMessage = vi.fn();
vi.mock('../session/session-runner.js', () => ({
  streamMessage: (...args: unknown[]) => mockStreamMessage(...args),
}));

function createApp(sessionManager: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use(createAIStreamRouter({ sessionManager: sessionManager as never }));
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

function parseSSELines(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .filter(Boolean)
    .filter((line) => line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.replace('data: ', '')) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// extractUserMessage
// ---------------------------------------------------------------------------

describe('extractUserMessage', () => {
  it('extracts text from parts-based format', () => {
    const result = extractUserMessage([
      { role: 'user', parts: [{ type: 'text', text: 'Hello world' }] },
    ]);
    expect(result).toBe('Hello world');
  });

  it('extracts text from content string format', () => {
    const result = extractUserMessage([
      { role: 'user', content: 'Hello world' },
    ]);
    expect(result).toBe('Hello world');
  });

  it('prefers parts over content', () => {
    const result = extractUserMessage([
      {
        role: 'user',
        parts: [{ type: 'text', text: 'from parts' }],
        content: 'from content',
      },
    ]);
    expect(result).toBe('from parts');
  });

  it('uses last message in array', () => {
    const result = extractUserMessage([
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second' }] },
    ]);
    expect(result).toBe('second');
  });

  it('returns empty string for empty array', () => {
    expect(extractUserMessage([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// translateEvent
// ---------------------------------------------------------------------------

describe('translateEvent', () => {
  function makeState() {
    return {
      messageId: 'msg-test-123',
      textBlockOpen: false,
      textBlockId: '',
      textBlockCounter: 0,
    };
  }

  it('translates init → message-start + start-step', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.Init,
      session_id: 'sess-1',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'message-start', messageId: 'msg-test-123' },
      { type: 'start-step' },
    ]);
  });

  it('translates first text_delta → text-start + text-delta', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.TextDelta,
      content: 'Hello',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
    ]);
    expect(state.textBlockOpen).toBe(true);
  });

  it('translates subsequent text_delta → text-delta only', () => {
    const state = makeState();
    state.textBlockOpen = true;
    state.textBlockCounter = 1;
    state.textBlockId = 'text-1';

    const event: SSEEvent = {
      type: SSEEventType.TextDelta,
      content: ' world',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'text-delta', id: 'text-1', delta: ' world' },
    ]);
  });

  it('closes text block before tool_call_start', () => {
    const state = makeState();
    state.textBlockOpen = true;
    state.textBlockCounter = 1;
    state.textBlockId = 'text-1';

    const event: SSEEvent = {
      type: SSEEventType.ToolCallStart,
      tool_name: 'request',
      tool_id: 'tc-1',
      parameters: { url: 'https://example.com' },
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result[0]).toEqual({ type: 'text-end', id: 'text-1' });
    expect(result[1]).toEqual({
      type: 'tool-input-start',
      toolCallId: 'tc-1',
      toolName: 'request',
    });
    expect(result[2]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'tc-1',
      toolName: 'request',
      input: { url: 'https://example.com' },
    });
    expect(state.textBlockOpen).toBe(false);
  });

  it('translates tool_call_start without open text block', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.ToolCallStart,
      tool_name: 'shell_exec',
      tool_id: 'tc-2',
      parameters: { command: 'ls' },
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'tool-input-start', toolCallId: 'tc-2', toolName: 'shell_exec' },
      { type: 'tool-input-available', toolCallId: 'tc-2', toolName: 'shell_exec', input: { command: 'ls' } },
    ]);
  });

  it('translates successful tool_call_result → tool-output-available', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.ToolCallResult,
      tool_id: 'tc-1',
      status: 'success',
      result: 'OK',
      duration_ms: 100,
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'tool-output-available', toolCallId: 'tc-1', output: { result: 'OK' } },
    ]);
  });

  it('translates error tool_call_result → tool-output-error', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.ToolCallResult,
      tool_id: 'tc-1',
      status: 'error',
      error: 'Connection timeout',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'tool-output-error', toolCallId: 'tc-1', errorText: 'Connection timeout' },
    ]);
  });

  it('uses default error text when error field is missing', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.ToolCallResult,
      tool_id: 'tc-1',
      status: 'error',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'tool-output-error', toolCallId: 'tc-1', errorText: 'Tool call failed' },
    ]);
  });

  it('translates subagent_event → data-subagent', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.SubagentEvent,
      parent_tool_id: 'tc-1',
      agent_name: 'entity-profiler',
      event_type: 'tool_call_start',
      tool_name: 'request',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'data-subagent',
      data: {
        parent_tool_id: 'tc-1',
        agent_name: 'entity-profiler',
        event_type: 'tool_call_start',
        tool_name: 'request',
      },
    });
  });

  it('translates skill_activated → data-skill-activated', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.SkillActivated,
      skill_name: 'triage',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'data-skill-activated', data: { skill_name: 'triage' } },
    ]);
  });

  it('translates widget → data-widget', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.Widget,
      widget_type: 'entity-card',
      data: { name: 'Device-001' },
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      {
        type: 'data-widget',
        data: { widget_type: 'entity-card', data: { name: 'Device-001' } },
      },
    ]);
  });

  it('translates kb_proposal → data-kb-proposal', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.KBProposal,
      proposal_id: 'prop-1',
      scope: 'application',
      title: 'New pattern',
      reasoning: 'Observed recurring behavior',
      status: 'pending',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      {
        type: 'data-kb-proposal',
        data: {
          proposal_id: 'prop-1',
          scope: 'application',
          title: 'New pattern',
          reasoning: 'Observed recurring behavior',
          status: 'pending',
        },
      },
    ]);
  });

  it('translates ask_user → data-ask-user', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.AskUser,
      ask_id: 'ask-1',
      questions: [{ id: 'q1', text: 'Are you sure?' }] as never,
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'data-ask-user',
      data: {
        ask_id: 'ask-1',
      },
    });
  });

  it('translates credential_saved → data-credential-saved', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.CredentialSaved,
      connection_name: 'datadog',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'data-credential-saved', data: { connection_name: 'datadog' } },
    ]);
  });

  it('translates approved → data-approved', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.Approved,
      resource_type: 'tool',
      preview_id: 'prev-1',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      {
        type: 'data-approved',
        data: { resource_type: 'tool', preview_id: 'prev-1' },
      },
    ]);
  });

  it('translates error → error event', () => {
    const state = makeState();
    const event: SSEEvent = {
      type: SSEEventType.Error,
      message: 'Something went wrong',
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'error', errorText: 'Something went wrong' },
    ]);
  });

  it('translates done with open text block → text-end + finish-step + finish', () => {
    const state = makeState();
    state.textBlockOpen = true;
    state.textBlockCounter = 1;
    state.textBlockId = 'text-1';

    const event: SSEEvent = {
      type: SSEEventType.Done,
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'text-end', id: 'text-1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('translates done without open text block → finish-step + finish', () => {
    const state = makeState();

    const event: SSEEvent = {
      type: SSEEventType.Done,
      timestamp: '2024-01-01T00:00:00Z',
    };

    const result = translateEvent(event, state);

    expect(result).toEqual([
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

describe('POST /chat/ai-stream', () => {
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

  it('sets x-vercel-ai-ui-message-stream header', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }] });

    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('translates SSE events to UI Message Stream format', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: '2024-01-01T00:00:00Z' },
        { type: SSEEventType.TextDelta, content: 'Hello', timestamp: '2024-01-01T00:00:01Z' },
        { type: SSEEventType.TextDelta, content: ' world', timestamp: '2024-01-01T00:00:02Z' },
        { type: SSEEventType.Done, timestamp: '2024-01-01T00:00:03Z' },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }] });

    const events = parseSSELines(res.text);

    // message-start, start-step, text-start, text-delta("Hello"), text-delta(" world"), text-end, finish-step, finish
    expect(events[0]).toMatchObject({ type: 'message-start' });
    expect(events[1]).toEqual({ type: 'start-step' });
    expect(events[2]).toMatchObject({ type: 'text-start' });
    expect(events[3]).toMatchObject({ type: 'text-delta', delta: 'Hello' });
    expect(events[4]).toMatchObject({ type: 'text-delta', delta: ' world' });
    expect(events[5]).toMatchObject({ type: 'text-end' });
    expect(events[6]).toEqual({ type: 'finish-step' });
    expect(events[7]).toEqual({ type: 'finish', finishReason: 'stop' });
  });

  it('ends with [DONE] sentinel', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }] });

    expect(res.text).toContain('data: [DONE]');
  });

  it('extracts user message from parts-based format', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello from parts' }] }] });

    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.anything(),
      'hello from parts',
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });

  it('extracts user message from content string format', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', content: 'hello from content' }] });

    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.anything(),
      'hello from content',
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });

  it('returns 400 for empty messages array', async () => {
    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no text found in messages', async () => {
    mockStreamMessage.mockReturnValue(makeEvents([]));

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'image', text: undefined }] }] });

    expect(res.status).toBe(400);
  });

  it('passes session_id from body to session manager', async () => {
    const existingSession = {
      id: 'existing-sess',
      config: {},
      geminiClient: {},
      scheduler: {},
    };
    mockGet.mockReturnValue(existingSession);
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'existing-sess', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        session_id: 'existing-sess',
      });

    expect(mockGet).toHaveBeenCalledWith('existing-sess');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates new session when no session_id provided', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: new Date().toISOString() },
        { type: SSEEventType.Done, timestamp: new Date().toISOString() },
      ]),
    );

    await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }] });

    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('translates tool events correctly', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: '2024-01-01T00:00:00Z' },
        {
          type: SSEEventType.ToolCallStart,
          tool_name: 'request',
          tool_id: 'tc-1',
          parameters: { url: '/api/data' },
          timestamp: '2024-01-01T00:00:01Z',
        },
        {
          type: SSEEventType.ToolCallResult,
          tool_id: 'tc-1',
          status: 'success',
          result: '{"data": []}',
          duration_ms: 150,
          timestamp: '2024-01-01T00:00:02Z',
        },
        { type: SSEEventType.Done, timestamp: '2024-01-01T00:00:03Z' },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'query data' }] }] });

    const events = parseSSELines(res.text);

    // message-start, start-step, tool-input-start, tool-input-available, tool-output-available, finish-step, finish
    const toolStart = events.find((e) => e['type'] === 'tool-input-start');
    expect(toolStart).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'tc-1',
      toolName: 'request',
    });

    const toolInput = events.find((e) => e['type'] === 'tool-input-available');
    expect(toolInput).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'tc-1',
      input: { url: '/api/data' },
    });

    const toolOutput = events.find((e) => e['type'] === 'tool-output-available');
    expect(toolOutput).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'tc-1',
      output: { result: '{"data": []}' },
    });
  });

  it('translates custom data parts (widget, skill, kb_proposal)', async () => {
    mockStreamMessage.mockReturnValue(
      makeEvents([
        { type: SSEEventType.Init, session_id: 'sess-1', timestamp: '2024-01-01T00:00:00Z' },
        { type: SSEEventType.SkillActivated, skill_name: 'investigate', timestamp: '2024-01-01T00:00:01Z' },
        { type: SSEEventType.Widget, widget_type: 'timeline', data: { entries: [] }, timestamp: '2024-01-01T00:00:02Z' },
        {
          type: SSEEventType.KBProposal,
          proposal_id: 'p-1',
          scope: 'application',
          title: 'New baseline',
          reasoning: 'Observed pattern',
          status: 'pending',
          timestamp: '2024-01-01T00:00:03Z',
        },
        { type: SSEEventType.Done, timestamp: '2024-01-01T00:00:04Z' },
      ]),
    );

    const res = await request(createApp(sessionManager))
      .post('/chat/ai-stream')
      .send({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'investigate' }] }] });

    const events = parseSSELines(res.text);

    const skill = events.find((e) => e['type'] === 'data-skill-activated');
    expect(skill).toEqual({ type: 'data-skill-activated', data: { skill_name: 'investigate' } });

    const widget = events.find((e) => e['type'] === 'data-widget');
    expect(widget).toEqual({
      type: 'data-widget',
      data: { widget_type: 'timeline', data: { entries: [] } },
    });

    const kb = events.find((e) => e['type'] === 'data-kb-proposal');
    expect(kb).toEqual({
      type: 'data-kb-proposal',
      data: {
        proposal_id: 'p-1',
        scope: 'application',
        title: 'New baseline',
        reasoning: 'Observed pattern',
        status: 'pending',
      },
    });
  });
});
