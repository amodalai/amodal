/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, toolCallSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { useAmodalBrief } from './useAmodalBrief';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
      {children}
    </AmodalProvider>
  );
}

describe('useAmodalBrief', () => {
  it('auto-fetches on mount and returns brief', async () => {
    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'summarize' }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.brief).not.toBeNull();
    expect(result.current.brief?.text).toBe('Hello, world!');
    expect(result.current.error).toBeNull();
  });

  it('does not auto-fetch when autoFetch is false', () => {
    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'summarize', autoFetch: false }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.brief).toBeNull();
  });

  it('collects tool calls in brief result', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'check' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.brief?.toolCalls).toHaveLength(1);
    expect(result.current.brief?.toolCalls[0]).toMatchObject({ toolName: 'request', status: 'success' });
  });

  it('handles errors', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'fail' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('can refresh', async () => {
    let callCount = 0;
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () => {
        callCount++;
        return new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: `Response ${String(callCount)}`, timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'summarize' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.brief?.text).toBe('Response 1');

    result.current.refresh();

    await waitFor(() => {
      expect(result.current.brief?.text).toBe('Response 2');
    });
  });

  it('handles SSE error event', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'error', message: 'Server overloaded', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalBrief({ prompt: 'summarize' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Server overloaded');
  });
});
