/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Focused tests for using useChatStream directly (without a wrapper hook).
 * The reducer itself is covered more broadly by useChat.test.tsx and
 * useAmodalChat.test.tsx since both now delegate to this hook.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatStream } from '../hooks/useChatStream';
import type { SSEEvent } from '../types';

async function* events(list: SSEEvent[]): AsyncIterable<SSEEvent> {
  for (const e of list) {
    // Yield on a microtask so the reducer + React commit phase can settle.
    await Promise.resolve();
    yield e;
  }
}

const now = (): string => new Date().toISOString();

describe('useChatStream — direct usage', () => {
  it('dispatches tool_call_start/result events and tracks activeToolCalls', async () => {
    const streamFn = vi.fn((): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 's1', timestamp: now() },
        { type: 'tool_call_start', tool_id: 't1', tool_name: 'read_repo_file', parameters: { path: 'a.md' }, timestamp: now() },
        { type: 'tool_call_result', tool_id: 't1', status: 'success', result: 'ok', duration_ms: 42, timestamp: now() },
        { type: 'text_delta', content: 'done', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]),
    );

    const { result } = renderHook(() => useChatStream({ streamFn }));

    act(() => { result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

    expect(streamFn).toHaveBeenCalledOnce();
    expect(result.current.sessionId).toBe('s1');
    expect(result.current.activeToolCalls).toHaveLength(0);

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.type).toBe('assistant_text');
    if (last.type !== 'assistant_text') throw new Error('unreachable');
    expect(last.toolCalls).toHaveLength(1);
    expect(last.toolCalls[0]?.toolName).toBe('read_repo_file');
    expect(last.toolCalls[0]?.status).toBe('success');
    expect(last.toolCalls[0]?.duration_ms).toBe(42);

    // Content blocks carry both the tool-call block and the text block.
    expect(last.contentBlocks).toHaveLength(2);
    expect(last.contentBlocks[0]?.type).toBe('tool_calls');
    expect(last.contentBlocks[1]?.type).toBe('text');
  });

  it('calls onSessionCreated and onStreamEnd in order', async () => {
    const onSessionCreated = vi.fn();
    const onStreamEnd = vi.fn();
    const streamFn = (): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 'abc', timestamp: now() },
        { type: 'text_delta', content: 'hi', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]);

    const { result } = renderHook(() => useChatStream({ streamFn, onSessionCreated, onStreamEnd }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

    expect(onSessionCreated).toHaveBeenCalledWith('abc');
    expect(onStreamEnd).toHaveBeenCalledOnce();
  });

  it('stop() aborts the stream', async () => {
    // A streamFn that hangs until the signal fires.
    const streamFn = (_text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'init', session_id: 's1', timestamp: now() };
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
          });
        },
      });

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.sessionId).toBe('s1'); });

    act(() => { result.current.stop(); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    // AbortError is swallowed — no error state.
    expect(result.current.error).toBeNull();
  });

  it('reset() clears messages and state', async () => {
    const streamFn = (): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 's1', timestamp: now() },
        { type: 'text_delta', content: 'first', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]);

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => { result.current.reset(); });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sessionId).toBeNull();
  });

  it('surfaces stream errors via the error state', async () => {
    const streamFn = (): AsyncIterable<SSEEvent> => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'init' as const, session_id: 'err-session', timestamp: now() };
        throw new Error('transport boom');
      },
    });

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    expect(result.current.error).toBe('transport boom');
  });
});
