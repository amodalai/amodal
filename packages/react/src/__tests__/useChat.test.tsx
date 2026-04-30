/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useChat } from '../hooks/useChat';
import { chatReducer } from '../hooks/useChat';
import { server } from '../test/mocks/server';
import { encodeSSEEvents, widgetToolCallSSEEvents as toolCallSSEEvents, skillAndKBSSEEvents, widgetSSEEvents } from '../test/mocks/handlers';
import type { ChatState, ChatAction } from '../types';
import type { WidgetEvent } from '../events/types';

const defaultOptions = {
  serverUrl: 'http://localhost:4555',
  user: { id: 'analyst-1' },
};

describe('chatReducer', () => {
  const initialState: ChatState = {
    messages: [],
    sessionId: null,
    isStreaming: false,
    error: null,
    activeToolCalls: [],
    isHistorical: false, usage: {inputTokens: 0, outputTokens: 0},
  };

  it('handles SEND_MESSAGE', () => {
    const action: ChatAction = { type: 'SEND_MESSAGE', text: 'hello' };
    const next = chatReducer(initialState, action);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toMatchObject({ type: 'user', text: 'hello' });
    expect(next.messages[1]).toMatchObject({ type: 'assistant_text', text: '' });
    expect(next.isStreaming).toBe(true);
    expect(next.error).toBeNull();
  });

  it('handles STREAM_INIT', () => {
    const next = chatReducer(initialState, { type: 'STREAM_INIT', sessionId: 's1' });
    expect(next.sessionId).toBe('s1');
  });

  it('handles STREAM_TEXT_DELTA', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const next = chatReducer(stateWithMsg, { type: 'STREAM_TEXT_DELTA', content: 'Hello' });
    const last = next.messages[next.messages.length - 1];
    expect(last.type === 'assistant_text' && last.text).toBe('Hello');
  });

  it('handles STREAM_TOOL_CALL_START', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const next = chatReducer(stateWithMsg, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'shell_exec',
      parameters: { cmd: 'ls' },
    });
    const last = next.messages[next.messages.length - 1];
    expect(last.type === 'assistant_text' && last.toolCalls).toHaveLength(1);
    expect(next.activeToolCalls).toHaveLength(1);
    // Should also add to contentBlocks
    if (last.type === 'assistant_text') {
      expect(last.contentBlocks).toHaveLength(1);
      expect(last.contentBlocks[0]).toMatchObject({ type: 'tool_calls' });
      if (last.contentBlocks[0].type === 'tool_calls') {
        expect(last.contentBlocks[0].calls).toHaveLength(1);
        expect(last.contentBlocks[0].calls[0]).toMatchObject({ toolName: 'shell_exec', status: 'running' });
      }
    }
  });

  it('groups consecutive tool calls in one content block', () => {
    let state = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'shell_exec',
      parameters: { cmd: 'ls' },
    });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc2',
      toolName: 'shell_exec',
      parameters: { cmd: 'pwd' },
    });
    const last = state.messages[state.messages.length - 1];
    if (last.type === 'assistant_text') {
      // Two consecutive tool calls should be in ONE tool_calls block
      expect(last.contentBlocks).toHaveLength(1);
      expect(last.contentBlocks[0]).toMatchObject({ type: 'tool_calls' });
      if (last.contentBlocks[0].type === 'tool_calls') {
        expect(last.contentBlocks[0].calls).toHaveLength(2);
      }
    }
  });

  it('creates new tool_calls block after text', () => {
    let state = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'shell_exec',
      parameters: {},
    });
    // Text arrives between tool call groups
    state = chatReducer(state, { type: 'STREAM_TEXT_DELTA', content: 'Checking...' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc2',
      toolName: 'shell_exec',
      parameters: {},
    });
    const last = state.messages[state.messages.length - 1];
    if (last.type === 'assistant_text') {
      // Should be: tool_calls, text, tool_calls
      expect(last.contentBlocks).toHaveLength(3);
      expect(last.contentBlocks[0]).toMatchObject({ type: 'tool_calls' });
      expect(last.contentBlocks[1]).toMatchObject({ type: 'text', text: 'Checking...' });
      expect(last.contentBlocks[2]).toMatchObject({ type: 'tool_calls' });
    }
  });

  it('handles STREAM_TOOL_CALL_RESULT', () => {
    let state = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'shell_exec',
      parameters: {},
    });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_RESULT',
      toolId: 'tc1',
      status: 'success',
      duration_ms: 100,
    });
    const last = state.messages[state.messages.length - 1];
    expect(
      last.type === 'assistant_text' && last.toolCalls[0]?.status,
    ).toBe('success');
    expect(state.activeToolCalls).toHaveLength(0);
    // ContentBlock should also be updated
    if (last.type === 'assistant_text' && last.contentBlocks[0]?.type === 'tool_calls') {
      expect(last.contentBlocks[0].calls[0]?.status).toBe('success');
      expect(last.contentBlocks[0].calls[0]?.duration_ms).toBe(100);
    }
  });

  it('handles STREAM_SKILL_ACTIVATED', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const next = chatReducer(stateWithMsg, {
      type: 'STREAM_SKILL_ACTIVATED',
      skill: 'triage',
    });
    const last = next.messages[next.messages.length - 1];
    expect(
      last.type === 'assistant_text' && last.skillActivations,
    ).toContain('triage');
  });

  it('handles STREAM_KB_PROPOSAL', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const next = chatReducer(stateWithMsg, {
      type: 'STREAM_KB_PROPOSAL',
      scope: 'org',
      title: 'New pattern',
      reasoning: 'Found during investigation',
    });
    const last = next.messages[next.messages.length - 1];
    expect(
      last.type === 'assistant_text' && last.kbProposals,
    ).toHaveLength(1);
  });

  it('handles STREAM_WIDGET', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const next = chatReducer(stateWithMsg, {
      type: 'STREAM_WIDGET',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01' },
    });
    const last = next.messages[next.messages.length - 1];
    expect(last.type === 'assistant_text' && last.widgets).toHaveLength(1);
    expect(last.type === 'assistant_text' && last.widgets[0]).toMatchObject({
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01' },
    });
    // Should also add to contentBlocks
    expect(last.type === 'assistant_text' && last.contentBlocks).toHaveLength(1);
    if (last.type === 'assistant_text') {
      expect(last.contentBlocks[0]).toMatchObject({
        type: 'widget',
        widgetType: 'entity-card',
      });
    }
  });

  it('handles STREAM_ASK_USER', () => {
    const stateWithMsg = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    const questions = [
      { question: 'Which zone?', header: 'Zone', type: 'choice' as const, options: [{ label: 'A', description: 'Zone A' }] },
    ];
    const next = chatReducer(stateWithMsg, {
      type: 'STREAM_ASK_USER',
      askId: 'ask-1',
      questions,
    });
    const last = next.messages[next.messages.length - 1];
    if (last.type === 'assistant_text') {
      expect(last.contentBlocks).toHaveLength(1);
      expect(last.contentBlocks[0]).toMatchObject({
        type: 'ask_user',
        askId: 'ask-1',
        status: 'pending',
      });
      if (last.contentBlocks[0].type === 'ask_user') {
        expect(last.contentBlocks[0].questions).toHaveLength(1);
      }
    }
  });

  it('handles ASK_USER_SUBMITTED', () => {
    let state = chatReducer(initialState, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_ASK_USER',
      askId: 'ask-1',
      questions: [{ question: 'Which zone?', header: 'Zone', type: 'choice' as const }],
    });
    state = chatReducer(state, {
      type: 'ASK_USER_SUBMITTED',
      askId: 'ask-1',
      answers: { '0': 'Zone A' },
    });
    const last = state.messages[state.messages.length - 1];
    if (last.type === 'assistant_text' && last.contentBlocks[0]?.type === 'ask_user') {
      expect(last.contentBlocks[0].status).toBe('submitted');
      expect(last.contentBlocks[0].answers).toEqual({ '0': 'Zone A' });
    }
  });

  it('handles STREAM_ERROR', () => {
    const next = chatReducer(initialState, { type: 'STREAM_ERROR', message: 'fail' });
    expect(next.error).toBe('fail');
    expect(next.isStreaming).toBe(false);
  });

  it('handles STREAM_DONE', () => {
    const streaming = { ...initialState, isStreaming: true };
    const next = chatReducer(streaming, { type: 'STREAM_DONE' });
    expect(next.isStreaming).toBe(false);
  });

  it('handles RESET', () => {
    const dirty: ChatState = {
      messages: [{ type: 'user' as const, id: '1', text: 'hi', timestamp: 't' }],
      sessionId: 's1',
      isStreaming: false,
      error: 'err',
      activeToolCalls: [],
      isHistorical: false, usage: {inputTokens: 0, outputTokens: 0},
    };
    const next = chatReducer(dirty, { type: 'RESET' });
    expect(next.messages).toHaveLength(0);
    expect(next.sessionId).toBeNull();
    expect(next.error).toBeNull();
  });
});

describe('useChat hook', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useChat(defaultOptions));
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.session.id).toBeNull();
  });

  it('sends a message and receives stream', async () => {
    const { result } = renderHook(() => useChat(defaultOptions));

    act(() => {
      result.current.send('hello');
    });

    // Should have user + assistant messages immediately
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ type: 'user', text: 'hello' });
    expect(result.current.isStreaming).toBe(true);

    // Wait for streaming to complete
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // Should have accumulated text
    const assistant = result.current.messages[1];
    expect(assistant.type === 'assistant_text' && assistant.text).toBe('Hello, world!');
    expect(result.current.session.id).toBe('test-session-1');
  });

  it('handles tool call events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const onToolCall = vi.fn();
    const { result } = renderHook(() =>
      useChat({ ...defaultOptions, onToolCall }),
    );

    act(() => {
      result.current.send('check zone');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const assistant = result.current.messages[1];
    expect(assistant.type === 'assistant_text' && assistant.toolCalls).toHaveLength(1);
    expect(onToolCall).toHaveBeenCalled();
  });

  it('handles skill and KB proposal events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(skillAndKBSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const onKBProposal = vi.fn();
    const { result } = renderHook(() =>
      useChat({ ...defaultOptions, onKBProposal }),
    );

    act(() => {
      result.current.send('investigate');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const assistant = result.current.messages[1];
    if (assistant.type === 'assistant_text') {
      expect(assistant.skillActivations).toContain('triage');
      expect(assistant.kbProposals).toHaveLength(1);
      expect(assistant.kbProposals[0]).toMatchObject({ scope: 'segment', title: 'Rogue sensor in Zone C' });
    }
    expect(onKBProposal).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'segment', title: 'Rogue sensor in Zone C' }),
    );
  });

  it('handles widget events in stream', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(widgetSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const { result } = renderHook(() => useChat(defaultOptions));

    act(() => {
      result.current.send('investigate');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const assistant = result.current.messages[1];
    if (assistant.type === 'assistant_text') {
      // Should have accumulated text from both text_delta events
      expect(assistant.text).toContain('I found a suspicious device.');
      expect(assistant.text).toContain('This is likely a rogue sensor.');

      // Should have 2 widgets
      expect(assistant.widgets).toHaveLength(2);
      expect(assistant.widgets[0]).toMatchObject({
        widgetType: 'entity-card',
        data: { mac: 'AA:BB:CC:DD:EE:01' },
      });
      expect(assistant.widgets[1]).toMatchObject({
        widgetType: 'scope-map',
      });

      // ContentBlocks should interleave text and widgets
      expect(assistant.contentBlocks.length).toBeGreaterThanOrEqual(4);
      expect(assistant.contentBlocks[0]).toMatchObject({ type: 'text' });
      expect(assistant.contentBlocks[1]).toMatchObject({ type: 'widget', widgetType: 'entity-card' });
      expect(assistant.contentBlocks[2]).toMatchObject({ type: 'text' });
      expect(assistant.contentBlocks[3]).toMatchObject({ type: 'widget', widgetType: 'scope-map' });
    }
  });

  it('handles stream errors', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' }),
      ),
    );

    const { result } = renderHook(() => useChat(defaultOptions));

    act(() => {
      result.current.send('fail');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.error).toContain('500');
  });

  it('resets state', async () => {
    const { result } = renderHook(() => useChat(defaultOptions));

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.session.id).toBeNull();
  });

  it('queues message sent while streaming and sends after stream ends', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return new HttpResponse(encodeSSEEvents([
          { type: 'init', session_id: 's1', timestamp: 't' },
          { type: 'done', timestamp: 't' },
        ]), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const { result } = renderHook(() => useChat(defaultOptions));

    act(() => {
      result.current.send('first');
    });

    expect(result.current.isStreaming).toBe(true);

    // Send while streaming — should be queued
    act(() => {
      result.current.send('second');
    });

    // During streaming: only first message's user + assistant
    expect(result.current.messages).toHaveLength(2);

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // After both streams complete: both user messages should exist
    await waitFor(() => {
      const userMessages = result.current.messages.filter((m) => m.type === 'user');
      expect(userMessages).toHaveLength(2);
    });
  });

  it('fires onEvent for tool_executed events with correct name and params', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const events: WidgetEvent[] = [];
    const onEvent = vi.fn((e: WidgetEvent) => { events.push(e); });
    const { result } = renderHook(() =>
      useChat({ ...defaultOptions, onEvent }),
    );

    act(() => {
      result.current.send('check zone');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // Should have at least one tool_executed event
    const toolEvents = events.filter((e) => e.type === 'tool_executed');
    expect(toolEvents).toHaveLength(1);
    if (toolEvents[0].type === 'tool_executed') {
      expect(toolEvents[0].toolName).toBe('shell_exec');
      expect(toolEvents[0].parameters).toEqual({ command: 'curl http://localhost:4444/devices?zone=C' });
    }
  });

  it('fires onEvent for widget_rendered events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(widgetSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const events: WidgetEvent[] = [];
    const onEvent = vi.fn((e: WidgetEvent) => { events.push(e); });
    const { result } = renderHook(() =>
      useChat({ ...defaultOptions, onEvent }),
    );

    act(() => {
      result.current.send('investigate');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const widgetEvents = events.filter((e) => e.type === 'widget_rendered');
    expect(widgetEvents).toHaveLength(2);

    // entity_referenced events from extractors should also be reported
    const entityEvents = events.filter((e) => e.type === 'entity_referenced');
    expect(entityEvents.length).toBeGreaterThan(0);
  });

  it('fires onEvent for skill_activated and kb_proposal events', async () => {
    server.use(
      http.post('http://localhost:4555/chat/stream', () =>
        new HttpResponse(encodeSSEEvents(skillAndKBSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const events: WidgetEvent[] = [];
    const onEvent = vi.fn((e: WidgetEvent) => { events.push(e); });
    const { result } = renderHook(() =>
      useChat({ ...defaultOptions, onEvent }),
    );

    act(() => {
      result.current.send('investigate');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(events.some((e) => e.type === 'skill_activated')).toBe(true);
    expect(events.some((e) => e.type === 'kb_proposal')).toBe(true);
  });

  it('exposes eventBus in return value', () => {
    const { result } = renderHook(() => useChat(defaultOptions));
    expect(result.current.eventBus).toBeDefined();
    expect(typeof result.current.eventBus.on).toBe('function');
  });

  describe('initialMessage', () => {
    it('auto-sends initialMessage on mount', async () => {
      const { result } = renderHook(() =>
        useChat({ ...defaultOptions, initialMessage: 'Analyze my docs' }),
      );

      // Should have user + assistant messages from the auto-send
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });
      expect(result.current.messages[0]).toMatchObject({ type: 'user', text: 'Analyze my docs' });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
      });
    });

    it('does not auto-send when initialMessage is undefined', () => {
      const { result } = renderHook(() =>
        useChat({ ...defaultOptions, initialMessage: undefined }),
      );
      expect(result.current.messages).toHaveLength(0);
    });

    it('does not auto-send when initialMessage is empty string', () => {
      const { result } = renderHook(() =>
        useChat({ ...defaultOptions, initialMessage: '' }),
      );
      expect(result.current.messages).toHaveLength(0);
    });

    it('sends initialMessage only once even on re-render', async () => {
      let callCount = 0;
      server.use(
        http.post('http://localhost:4555/chat/stream', () => {
          callCount++;
          return new HttpResponse(encodeSSEEvents([
            { type: 'init', session_id: 'init-session', timestamp: 't' },
            { type: 'text_delta', content: 'Response', timestamp: 't' },
            { type: 'done', timestamp: 't' },
          ]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const { result, rerender } = renderHook(() =>
        useChat({ ...defaultOptions, initialMessage: 'Analyze' }),
      );

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
      });

      // Re-render should not trigger another send
      rerender();
      rerender();

      // Wait a tick for any spurious effects
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });

      expect(callCount).toBe(1);
    });
  });

  describe('resumeSessionId', () => {
    it('shows error when session does not exist (404)', async () => {
      server.use(
        http.get('http://localhost:4555/sessions/history/:id', () => new HttpResponse(JSON.stringify({ error: 'not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })),
      );

      const { result } = renderHook(() =>
        useChat({ ...defaultOptions, resumeSessionId: 'deleted-session-123' }),
      );

      await waitFor(() => {
        expect(result.current.error).toBe('Previous session no longer exists. Start a new conversation.');
      });
    });

    it('shows generic error for non-404 failures', async () => {
      server.use(
        http.get('http://localhost:4555/sessions/history/:id', () => new HttpResponse(JSON.stringify({ error: 'internal' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })),
      );

      const { result } = renderHook(() =>
        useChat({ ...defaultOptions, resumeSessionId: 'broken-session' }),
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error).not.toContain('no longer exists');
      });
    });
  });
});
