/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * SSE endpoint for real-time Studio events.
 *
 * Browser clients open an EventSource to this route. Events are
 * sourced from the Postgres LISTEN/NOTIFY pipeline via the
 * StudioEventBus.
 */

import type { NextRequest } from 'next/server';
import { getEventBus } from '@/lib/event-bus';
import { initEventBridge } from '@/lib/event-bridge';

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(req: NextRequest): Promise<Response> {
  // Ensure the Postgres listener -> event bus bridge is initialized
  await initEventBridge();

  const bus = getEventBus();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to events
      const unsub = bus.subscribe((event) => {
        const frame = `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Controller closed (client disconnected)
          unsub();
        }
      });

      // Heartbeat to prevent proxy/LB timeouts
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        unsub();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed — no action needed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
