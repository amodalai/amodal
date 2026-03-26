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
import { useAmodalTask } from './useAmodalTask';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('useAmodalTask', () => {
  it('auto-streams and collects events', async () => {
    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-1' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });

    expect(result.current.events.length).toBeGreaterThanOrEqual(4);
    expect(result.current.result).toBe('Hello, world!');
  });

  it('does not auto-stream when autoStream is false', () => {
    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-1', autoStream: false }),
      { wrapper },
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.events).toHaveLength(0);
  });

  it('handles stream error', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/task/task-err/stream`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'error', message: 'Task failed', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-err' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('Task failed');
  });

  it('shows progress during tool calls', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/task/task-tools/stream`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: '' },
            { type: 'tool_call_start', tool_id: 'tc1', tool_name: 'request', parameters: {}, timestamp: '' },
            { type: 'tool_call_result', tool_id: 'tc1', status: 'success', timestamp: '' },
            { type: 'text_delta', content: 'Done', timestamp: '' },
            { type: 'done', timestamp: '' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-tools' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });

    expect(result.current.result).toBe('Done');
  });

  it('handles HTTP error', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/task/task-404/stream`, () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );

    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-404' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBeTruthy();
  });

  it('can be stopped', async () => {
    const { result } = renderHook(
      () => useAmodalTask({ taskId: 'task-1' }),
      { wrapper },
    );

    result.current.stop();

    // Stop should not cause error
    expect(result.current.error).toBeNull();
  });
});
