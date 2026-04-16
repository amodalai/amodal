/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { initEventBridge } from '../../lib/event-bridge.js';
import { getEventBus } from '../../lib/event-bus.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

export const eventsRoutes = new Hono();

eventsRoutes.get('/api/studio/events', async (c) => {
  await initEventBridge();
  const bus = getEventBus();

  return streamSSE(c, async (stream) => {
    const unsub = bus.subscribe((event) => {
      void stream.writeSSE({
        id: String(event.seq),
        event: event.type,
        data: JSON.stringify(event.payload),
      });
    });

    const heartbeat = setInterval(() => {
      void stream.writeSSE({ data: '' });
    }, HEARTBEAT_INTERVAL_MS);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsub();
    });

    // Keep the stream open until the client disconnects
    await new Promise(() => {});
  });
});
