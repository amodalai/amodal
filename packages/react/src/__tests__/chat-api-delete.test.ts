/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { deleteSession } from '../client/chat-api';
import { server } from '../test/mocks/server';

const BASE_URL = 'http://localhost:3847';

describe('deleteSession', () => {
  it('sends DELETE and resolves on success', async () => {
    server.use(
      http.delete(`${BASE_URL}/sessions/history/:id`, () => HttpResponse.json({ ok: true })),
    );
    await expect(deleteSession(BASE_URL, 'sess-123')).resolves.toBeUndefined();
  });

  it('throws ChatApiError on 404', async () => {
    server.use(
      http.delete(`${BASE_URL}/sessions/history/:id`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(deleteSession(BASE_URL, 'sess-missing')).rejects.toThrow('Delete session failed');
  });

  it('passes auth token as Bearer header', async () => {
    let authHeader: string | null = null;
    server.use(
      http.delete(`${BASE_URL}/sessions/history/:id`, ({ request }) => {
        authHeader = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );
    await deleteSession(BASE_URL, 'sess-123', 'my-token');
    expect(authHeader).toBe('Bearer my-token');
  });
});
