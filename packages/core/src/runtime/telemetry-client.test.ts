/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {PlatformTelemetrySink} from './telemetry-client.js';
import type {RuntimeTelemetryEvent} from './telemetry-hooks.js';

function makeEvent(type: RuntimeTelemetryEvent['type'] = 'tool_call', sessionId = 'sess-1'): RuntimeTelemetryEvent {
  return {
    type,
    sessionId,
    timestamp: Date.now(),
    data: {toolName: 'request', durationMs: 100, tokenCount: 50},
  };
}

describe('PlatformTelemetrySink', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ok: true});
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers events and flushes on explicit flush()', async () => {
    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 60_000, // long so it won't auto-flush
    });
    const cb = sink.sink();

    cb(makeEvent());
    cb(makeEvent());
    expect(sink.bufferedCount).toBe(2);

    await sink.flush();
    expect(sink.bufferedCount).toBe(0);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/telemetry/ingest');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'Authorization': 'Bearer key-123',
    }));

    const body = JSON.parse(String(opts.body)) as {events: RuntimeTelemetryEvent[]};
    expect(body.events).toHaveLength(2);

    await sink.destroy();
  });

  it('auto-flushes when buffer reaches batch size', async () => {
    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      batchSize: 3,
      flushIntervalMs: 60_000,
    });
    const cb = sink.sink();

    cb(makeEvent());
    cb(makeEvent());
    expect(fetchSpy).not.toHaveBeenCalled();

    cb(makeEvent()); // triggers flush at batchSize=3
    // flush is async — wait a tick
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    await sink.destroy();
  });

  it('flush is no-op when buffer is empty', async () => {
    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 60_000,
    });

    await sink.flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    await sink.destroy();
  });

  it('swallows fetch errors without throwing', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 60_000,
    });
    const cb = sink.sink();
    cb(makeEvent());

    // Should not throw
    await sink.flush();
    expect(sink.bufferedCount).toBe(0);

    await sink.destroy();
  });

  it('swallows non-ok responses without throwing', async () => {
    fetchSpy.mockResolvedValue({ok: false, status: 500});

    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 60_000,
    });
    const cb = sink.sink();
    cb(makeEvent());

    await sink.flush();
    expect(sink.bufferedCount).toBe(0);

    await sink.destroy();
  });

  it('destroy() stops accepting events and flushes remaining', async () => {
    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 60_000,
    });
    const cb = sink.sink();
    cb(makeEvent());
    cb(makeEvent());

    await sink.destroy();
    expect(fetchSpy).toHaveBeenCalledOnce(); // flushed on destroy

    // Events after destroy are ignored
    cb(makeEvent());
    expect(sink.bufferedCount).toBe(0);
  });

  it('strips trailing slash from platform URL', async () => {
    const sink = new PlatformTelemetrySink('http://localhost:4000/', 'key-123', {
      flushIntervalMs: 60_000,
    });
    const cb = sink.sink();
    cb(makeEvent());
    await sink.flush();

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:4000/api/telemetry/ingest');

    await sink.destroy();
  });

  it('auto-flushes on interval', async () => {
    vi.useFakeTimers();

    const sink = new PlatformTelemetrySink('http://localhost:4000', 'key-123', {
      flushIntervalMs: 1_000,
    });
    const cb = sink.sink();
    cb(makeEvent());

    expect(fetchSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_100);
    expect(fetchSpy).toHaveBeenCalledOnce();

    await sink.destroy();
    vi.useRealTimers();
  });
});
