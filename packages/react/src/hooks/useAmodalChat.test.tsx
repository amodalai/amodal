/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import {
  encodeSSEEvents,
  toolCallSSEEvents,
  confirmationSSEEvents,
  RUNTIME_TEST_URL,
} from '../../test/mocks/handlers';
import { useAmodalChat, chatReducer } from './useAmodalChat';
import { AmodalProvider } from '../provider';
import type { ChatState, ChatAction } from '../types';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} appId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('chatReducer', () => {
  const initial: ChatState = {
    messages: [],
    sessionId: null,
    isStreaming: false,
    error: null,
    activeToolCalls: [],
    isHistorical: false, usage: {inputTokens: 0, outputTokens: 0},
  };

  it('handles SEND_MESSAGE', () => {
    const action: ChatAction = { type: 'SEND_MESSAGE', text: 'hello' };
    const state = chatReducer(initial, action);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ type: 'user', text: 'hello' });
    expect(state.messages[1]).toMatchObject({ type: 'assistant_text', text: '' });
    expect(state.isStreaming).toBe(true);
  });

  it('handles STREAM_INIT', () => {
    const state = chatReducer(initial, { type: 'STREAM_INIT', sessionId: 's1' });
    expect(state.sessionId).toBe('s1');
  });

  it('handles STREAM_TEXT_DELTA', () => {
    const withAssistant = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    const state = chatReducer(withAssistant, { type: 'STREAM_TEXT_DELTA', content: 'Hello' });
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.type === 'assistant_text' && lastMsg.text).toBe('Hello');
  });

  it('merges consecutive text deltas into one content block', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, { type: 'STREAM_TEXT_DELTA', content: 'Hello' });
    state = chatReducer(state, { type: 'STREAM_TEXT_DELTA', content: ' world' });
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.contentBlocks).toHaveLength(1);
      expect(lastMsg.contentBlocks[0]).toMatchObject({ type: 'text', text: 'Hello world' });
    }
  });

  it('handles STREAM_TOOL_CALL_START and STREAM_TOOL_CALL_RESULT', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'request',
      parameters: { url: '/api' },
    });
    expect(state.activeToolCalls).toHaveLength(1);

    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_RESULT',
      toolId: 'tc1',
      status: 'success',
      result: 'ok',
      duration_ms: 100,
    });
    expect(state.activeToolCalls).toHaveLength(0);
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.toolCalls[0]).toMatchObject({ toolId: 'tc1', status: 'success' });
    }
  });

  it('handles STREAM_CONFIRMATION_REQUIRED', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_CONFIRMATION_REQUIRED',
      confirmation: {
        endpoint: '/api/tickets',
        method: 'POST',
        reason: 'Creates a ticket',
        escalated: false,
        correlationId: 'c1',
        status: 'pending',
      },
    });
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.confirmations).toHaveLength(1);
      expect(lastMsg.confirmations[0]).toMatchObject({ correlationId: 'c1', status: 'pending' });
    }
  });

  it('handles CONFIRMATION_RESPONDED', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_CONFIRMATION_REQUIRED',
      confirmation: {
        endpoint: '/api',
        method: 'POST',
        reason: 'test',
        escalated: false,
        correlationId: 'c1',
        status: 'pending',
      },
    });
    state = chatReducer(state, {
      type: 'CONFIRMATION_RESPONDED',
      correlationId: 'c1',
      approved: true,
    });
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.confirmations[0]).toMatchObject({ status: 'approved' });
    }
  });

  it('handles STREAM_ERROR', () => {
    const state = chatReducer(initial, { type: 'STREAM_ERROR', message: 'fail' });
    expect(state.error).toBe('fail');
    expect(state.isStreaming).toBe(false);
  });

  it('handles STREAM_DONE and stops running tool calls', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'request',
      parameters: {},
    });
    state = chatReducer(state, { type: 'STREAM_DONE' });
    expect(state.isStreaming).toBe(false);
    expect(state.activeToolCalls).toHaveLength(0);
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.toolCalls[0]).toMatchObject({ status: 'error', error: 'Stopped' });
    }
  });

  it('handles RESET', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, { type: 'RESET' });
    expect(state.messages).toHaveLength(0);
    expect(state.sessionId).toBeNull();
    expect(state.isStreaming).toBe(false);
  });

  it('handles STREAM_WIDGET', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_WIDGET',
      widgetType: 'entity-card',
      data: { name: 'test' },
    });
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      const widgetBlock = lastMsg.contentBlocks.find((b) => b.type === 'widget');
      expect(widgetBlock).toMatchObject({ type: 'widget', widgetType: 'entity-card' });
    }
  });

  it('handles STREAM_SUBAGENT_EVENT', () => {
    let state = chatReducer(initial, { type: 'SEND_MESSAGE', text: 'hi' });
    state = chatReducer(state, {
      type: 'STREAM_TOOL_CALL_START',
      toolId: 'tc1',
      toolName: 'dispatch',
      parameters: {},
    });
    state = chatReducer(state, {
      type: 'STREAM_SUBAGENT_EVENT',
      parentToolId: 'tc1',
      event: {
        agentName: 'sub-1',
        eventType: 'thought',
        text: 'thinking...',
        timestamp: '',
      },
    });
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.type === 'assistant_text') {
      expect(lastMsg.toolCalls[0].subagentEvents).toHaveLength(1);
    }
  });
});

describe('useAmodalChat', () => {
  it('sends a message and receives streaming response', async () => {
    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.current.sessionId).toBe('test-session-1');
  });

  it('accumulates text from text_delta events', async () => {
    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const assistant = result.current.messages.find((m) => m.type === 'assistant_text');
    expect(assistant && assistant.type === 'assistant_text' && assistant.text).toBe('Hello, world!');
  });

  it('tracks tool calls from stream', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('check something');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const assistant = result.current.messages.find((m) => m.type === 'assistant_text');
    if (assistant && assistant.type === 'assistant_text') {
      expect(assistant.toolCalls).toHaveLength(1);
      expect(assistant.toolCalls[0]).toMatchObject({ toolName: 'request', status: 'success' });
    }
  });

  it('handles confirmation_required events', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(confirmationSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const onConfirmation = vi.fn();
    const { result } = renderHook(
      () => useAmodalChat({ onConfirmation }),
      { wrapper },
    );

    act(() => {
      result.current.send('create a ticket');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(onConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/tickets',
        method: 'POST',
        status: 'pending',
      }),
    );
  });

  it('calls onStreamEnd callback', async () => {
    const onStreamEnd = vi.fn();
    const { result } = renderHook(
      () => useAmodalChat({ onStreamEnd }),
      { wrapper },
    );

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(onStreamEnd).toHaveBeenCalled();
  });

  it('calls onSessionCreated callback', async () => {
    const onSessionCreated = vi.fn();
    const { result } = renderHook(
      () => useAmodalChat({ onSessionCreated }),
      { wrapper },
    );

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(onSessionCreated).toHaveBeenCalledWith('test-session-1');
  });

  it('handles stream errors', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents([
          { type: 'init', session_id: 's1', timestamp: '' },
          { type: 'error', message: 'Internal error', timestamp: '' },
        ]), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('hello');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Internal error');
    });
  });

  it('stops the stream', async () => {
    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('hello');
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('resets the state', async () => {
    const { result } = renderHook(() => useAmodalChat(), { wrapper });

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
    expect(result.current.sessionId).toBeNull();
  });

  it('does not send while streaming', async () => {
    const { result } = renderHook(() => useAmodalChat(), { wrapper });

    act(() => {
      result.current.send('hello');
    });

    // Try to send while streaming
    act(() => {
      result.current.send('second');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // Only one user message + one assistant message
    const userMessages = result.current.messages.filter((m) => m.type === 'user');
    expect(userMessages).toHaveLength(1);
  });

  it('calls onToolCall callback', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const onToolCall = vi.fn();
    const { result } = renderHook(
      () => useAmodalChat({ onToolCall }),
      { wrapper },
    );

    act(() => {
      result.current.send('check');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(onToolCall).toHaveBeenCalled();
  });
});
