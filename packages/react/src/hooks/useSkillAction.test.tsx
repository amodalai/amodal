/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { useSkillAction } from './useSkillAction';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} appId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('useSkillAction', () => {
  it('executes a skill and collects the text result', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 'skill-session', timestamp: '2026-01-01T00:00:00Z' },
            { type: 'text_delta', content: 'Investigation complete. ', timestamp: '2026-01-01T00:00:01Z' },
            { type: 'text_delta', content: 'Found 3 issues.', timestamp: '2026-01-01T00:00:02Z' },
            { type: 'done', timestamp: '2026-01-01T00:00:03Z' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useSkillAction('deep-investigator', { stores: ['active-alerts'] }),
      { wrapper },
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();

    act(() => {
      result.current.execute({ correlationId: '123' });
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.result).toBe('Investigation complete. Found 3 issues.');
    expect(result.current.error).toBeNull();
  });

  it('handles errors during skill execution', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(
          encodeSSEEvents([
            { type: 'init', session_id: 'err-session', timestamp: '2026-01-01T00:00:00Z' },
            { type: 'error', message: 'Skill not found', timestamp: '2026-01-01T00:00:01Z' },
            { type: 'done', timestamp: '2026-01-01T00:00:02Z' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useSkillAction('nonexistent'),
      { wrapper },
    );

    act(() => {
      result.current.execute();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Skill not found');
  });
});
