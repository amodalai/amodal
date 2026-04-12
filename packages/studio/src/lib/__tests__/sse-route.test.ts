/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventBus, resetEventBus } from '../event-bus';

// Mock initEventBridge to be a no-op (avoids needing Postgres)
vi.mock('../event-bridge.js', () => ({
  initEventBridge: vi.fn().mockResolvedValue(undefined),
}));

describe('SSE route /api/studio/events', () => {
  beforeEach(() => {
    resetEventBus();
  });

  it('returns a Response with SSE content-type and correct headers', async () => {
    const { GET } = await import('@/app/api/studio/events/route');

    const controller = new AbortController();
    const req = new Request('http://localhost:3850/api/studio/events', {
      signal: controller.signal,
    });

    // NextRequest is just an extended Request in Next.js — the route
    // handler only uses .signal, so a plain Request works in tests.
    const response = await GET(req as Parameters<typeof GET>[0]);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(response.body).not.toBeNull();

    // Clean up
    controller.abort();
  });

  it('streams events emitted on the event bus', async () => {
    const { GET } = await import('@/app/api/studio/events/route');

    const controller = new AbortController();
    const req = new Request('http://localhost:3850/api/studio/events', {
      signal: controller.signal,
    });

    const response = await GET(req as Parameters<typeof GET>[0]);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Emit an event on the bus
    const bus = getEventBus();
    bus.emit('store_updated', { store: 'users', key: 'bob' });

    // Read the first chunk
    const { value, done } = await reader.read();
    expect(done).toBe(false);

    const text = decoder.decode(value);
    expect(text).toContain('event: store_updated');
    expect(text).toContain('data: {"store":"users","key":"bob"}');
    expect(text).toContain('id: ');

    // Clean up
    controller.abort();
  });
});
