/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { useAmodalQuery } from './useAmodalQuery';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
      {children}
    </AmodalProvider>
  );
}

describe('useAmodalQuery', () => {
  it('auto-fetches and returns data', async () => {
    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'what is 2+2' }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe('Hello, world!');
    expect(result.current.error).toBeNull();
  });

  it('does not auto-fetch when autoFetch is false', () => {
    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'question', autoFetch: false }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('handles errors', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'fail' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('can refetch', async () => {
    let callCount = 0;
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () => {
        callCount++;
        return new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: `Answer ${String(callCount)}`, timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'q' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe('Answer 1');

    result.current.refetch();

    await waitFor(() => {
      expect(result.current.data).toBe('Answer 2');
    });
  });

  it('handles SSE error event', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'error', message: 'Query failed', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'q' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Query failed');
  });

  it('returns empty string for empty response', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalQuery({ prompt: 'q' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe('');
  });
});
