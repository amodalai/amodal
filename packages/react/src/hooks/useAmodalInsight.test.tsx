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
import { useAmodalInsight } from './useAmodalInsight';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} appId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('useAmodalInsight', () => {
  it('auto-fetches and splits summary/details at double newline', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: 'Summary line\n\nDetails paragraph here.', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'analyze' }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.summary).toBe('Summary line');
    expect(result.current.details).toBe('Details paragraph here.');
  });

  it('puts everything in summary when no double newline', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: 'Just a summary', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'analyze' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.summary).toBe('Just a summary');
    expect(result.current.details).toBe('');
  });

  it('does not auto-fetch when autoFetch is false', () => {
    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'analyze', autoFetch: false }),
      { wrapper },
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.isLoading).toBe(false);
  });

  it('handles errors', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'fail' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBeTruthy();
  });

  it('handles SSE error event', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'error', message: 'Insight failed', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'analyze' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('Insight failed');
  });

  it('can refresh', async () => {
    let callCount = 0;
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () => {
        callCount++;
        return new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'text_delta', content: `Insight ${String(callCount)}`, timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    const { result } = renderHook(
      () => useAmodalInsight({ prompt: 'analyze' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(result.current.summary).toBe('Insight 1');

    result.current.refresh();

    await waitFor(() => {
      expect(result.current.summary).toBe('Insight 2');
    });
  });
});
