/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { initEventBridge } from '../../lib/event-bridge.js';
import { getEventBus } from '../../lib/event-bus.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

export const eventsRouter = Router();

eventsRouter.get('/api/studio/events', asyncHandler(async (req, res) => {
  await initEventBridge();
  const bus = getEventBus();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const unsub = bus.subscribe((event) => {
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(':\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsub();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}));
