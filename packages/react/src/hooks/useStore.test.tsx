/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { useStore } from './useStore';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} appId="t1">
      {children}
    </AmodalProvider>
  );
}

const mockDocument = {
  key: 'evt_123',
  appId: 'local',
  store: 'active-alerts',
  version: 2,
  payload: { event_id: 'evt_123', severity: 'P1', confidence: 0.92 },
  meta: { computedAt: '2026-01-01T00:00:00Z', stale: false, ttl: 300 },
};

const mockHistory = [
  {
    key: 'evt_123',
    appId: 'local',
    store: 'active-alerts',
    version: 1,
    payload: { event_id: 'evt_123', severity: 'P2', confidence: 0.6 },
    meta: { computedAt: '2025-12-31T00:00:00Z', stale: false },
  },
];

describe('useStore', () => {
  it('fetches a document by key', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/active-alerts/evt_123`, () =>
        HttpResponse.json({ document: mockDocument, history: mockHistory }),
      ),
    );

    const { result } = renderHook(
      () => useStore('active-alerts', { key: 'evt_123', refreshInterval: 0 }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockDocument.payload);
    expect(result.current.meta?.computedAt).toBe('2026-01-01T00:00:00Z');
    expect(result.current.document?.version).toBe(2);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('handles 404 (missing document)', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/active-alerts/missing`, () =>
        HttpResponse.json({ document: null, history: [] }, { status: 404 }),
      ),
    );

    const { result } = renderHook(
      () => useStore('active-alerts', { key: 'missing', refreshInterval: 0 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.document).toBeNull();
  });

  it('handles server errors', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/active-alerts/err`, () =>
        HttpResponse.json({ error: 'Internal error' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useStore('active-alerts', { key: 'err', refreshInterval: 0 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});
