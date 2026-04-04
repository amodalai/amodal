/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * SSE route for the runtime event bus.
 *
 * GET /api/events
 *
 * Clients open a single EventSource and receive every server-emitted
 * runtime event (session_created, automation_triggered, store_updated,
 * etc.) without polling.
 *
 * Reconnect-and-resume: clients may send a `Last-Event-ID` header
 * (EventSource does this automatically on reconnect). The bus replays
 * any buffered events with seq > Last-Event-ID before streaming live.
 *
 * Heartbeats: a comment line is sent every 15s so proxies don't close
 * the connection during quiet periods.
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {RuntimeEventBus} from './event-bus.js';

export interface EventsRouterOptions {
  bus: RuntimeEventBus;
  /** Heartbeat interval in ms. Default 15000. */
  heartbeatMs?: number;
}

const HEARTBEAT_DEFAULT_MS = 15_000;

export function createEventsRouter(options: EventsRouterOptions): Router {
  const router = Router();
  const {bus} = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_DEFAULT_MS;

  router.get('/api/events', (req: Request, res: Response) => {
    // Parse optional Last-Event-ID for reconnect-and-resume
    const lastIdHeader = req.header('Last-Event-ID');
    let sinceSeq: number | undefined;
    if (lastIdHeader) {
      const parsed = Number.parseInt(lastIdHeader, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        sinceSeq = parsed;
      }
    }

    // SSE response headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Disable nginx response buffering for SSE
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Subscribe to the bus. `subscribe` replays buffered events > sinceSeq
    // synchronously, then hands live events to the listener.
    const unsubscribe = bus.subscribe((event) => {
      // SSE frame: id + event + data. `id:` lets EventSource resume.
      res.write(`id: ${String(event.seq)}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, sinceSeq);

    // Heartbeat: SSE comment line every N seconds. Keeps proxies from
    // closing an idle connection and lets the client detect drops.
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, heartbeatMs);

    // Clean up on disconnect
    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
  });

  return router;
}
