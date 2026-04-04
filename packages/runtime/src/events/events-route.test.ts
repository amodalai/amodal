/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {RuntimeEventBus} from './event-bus.js';
import {createEventsRouter} from './events-route.js';

interface HarnessResult {
  port: number;
  server: Server;
  bus: RuntimeEventBus;
}

function startServer(bus: RuntimeEventBus): Promise<HarnessResult> {
  const app = express();
  app.use(createEventsRouter({bus, heartbeatMs: 60_000}));
  return new Promise<HarnessResult>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({port, server, bus});
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function collectEvents(
  url: string,
  expected: number,
  opts: {lastEventId?: string; timeoutMs?: number} = {},
): Promise<Array<Record<string, unknown>>> {
  const headers: Record<string, string> = {Accept: 'text/event-stream'};
  if (opts.lastEventId) headers['Last-Event-ID'] = opts.lastEventId;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);

  const res = await fetch(url, {headers, signal: controller.signal});
  if (!res.body) throw new Error('no response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const collected: Array<Record<string, unknown>> = [];
  let buffer = '';

  try {
    while (collected.length < expected) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          const json = dataLine.slice(5).trim();
           
          collected.push(JSON.parse(json) as Record<string, unknown>);
          if (collected.length >= expected) break;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    reader.cancel().catch(() => {});
  }

  return collected;
}

describe('events SSE route', () => {
  let harness: HarnessResult | null = null;

  afterEach(async () => {
    if (harness) {
      await closeServer(harness.server);
      harness = null;
    }
  });

  it('streams emitted events to connected clients', async () => {
    const bus = new RuntimeEventBus();
    harness = await startServer(bus);
    const url = `http://127.0.0.1:${String(harness.port)}/api/events`;

    const eventsPromise = collectEvents(url, 2, {timeoutMs: 2000});
    setTimeout(() => {
      bus.emit({type: 'session_created', sessionId: 's1', appId: 'local'});
      bus.emit({type: 'manifest_changed'});
    }, 50);

    const events = await eventsPromise;
    expect(events).toHaveLength(2);
    expect(events[0]?.['type']).toBe('session_created');
    expect(events[0]?.['seq']).toBe(1);
    expect(events[1]?.['type']).toBe('manifest_changed');
    expect(events[1]?.['seq']).toBe(2);
  });

  it('replays buffered events matching Last-Event-ID', async () => {
    const bus = new RuntimeEventBus();
    harness = await startServer(bus);
    const url = `http://127.0.0.1:${String(harness.port)}/api/events`;

    bus.emit({type: 'session_created', sessionId: 's1', appId: 'local'});
    bus.emit({type: 'session_created', sessionId: 's2', appId: 'local'});
    bus.emit({type: 'session_created', sessionId: 's3', appId: 'local'});

    const events = await collectEvents(url, 2, {lastEventId: '1', timeoutMs: 2000});
    expect(events).toHaveLength(2);
    expect(events[0]?.['seq']).toBe(2);
    expect(events[1]?.['seq']).toBe(3);
  });

  it('includes id and event headers in SSE frames', async () => {
    const bus = new RuntimeEventBus();
    harness = await startServer(bus);
    const url = `http://127.0.0.1:${String(harness.port)}/api/events`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      headers: {Accept: 'text/event-stream'},
      signal: controller.signal,
    });
    if (!res.body) throw new Error('no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    setTimeout(() => {
      bus.emit({type: 'manifest_changed'});
    }, 50);

    let raw = '';
    while (!raw.includes('\n\n')) {
      const {value, done} = await reader.read();
      if (done) break;
      raw += decoder.decode(value, {stream: true});
    }
    clearTimeout(timeout);
    controller.abort();
    reader.cancel().catch(() => {});

    expect(raw).toContain('id: 1');
    expect(raw).toContain('event: manifest_changed');
    expect(raw).toContain('data: {"type":"manifest_changed"');
  });
});
