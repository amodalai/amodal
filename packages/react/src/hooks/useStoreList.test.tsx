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
import { useStoreList } from './useStoreList';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} appId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('useStoreList', () => {
  it('fetches a list of documents', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/active-alerts`, () =>
        HttpResponse.json({
          documents: [
            { key: 'a', appId: 'local', store: 'active-alerts', version: 1, payload: { id: 'a', severity: 'P1' }, meta: { computedAt: '2026-01-01', stale: false } },
            { key: 'b', appId: 'local', store: 'active-alerts', version: 1, payload: { id: 'b', severity: 'P2' }, meta: { computedAt: '2026-01-01', stale: false } },
          ],
          total: 2,
          hasMore: false,
        }),
      ),
    );

    const { result } = renderHook(
      () => useStoreList('active-alerts', { refreshInterval: 0 }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0]['severity']).toBe('P1');
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes filter and sort as query params', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/active-alerts`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ documents: [], total: 0, hasMore: false });
      }),
    );

    const { result } = renderHook(
      () => useStoreList('active-alerts', {
        filter: { severity: 'P1' },
        sort: '-computedAt',
        limit: 5,
        refreshInterval: 0,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('filter')).toBe('{"severity":"P1"}');
    expect(url.searchParams.get('sort')).toBe('-computedAt');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('handles empty store', async () => {
    server.use(
      http.get(`${RUNTIME_TEST_URL}/api/stores/empty`, () =>
        HttpResponse.json({ documents: [], total: 0, hasMore: false }),
      ),
    );

    const { result } = renderHook(
      () => useStoreList('empty', { refreshInterval: 0 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.total).toBe(0);
  });
});
