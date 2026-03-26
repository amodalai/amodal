/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {RuntimeTelemetryEvent, TelemetrySink} from './telemetry-hooks.js';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

/**
 * Buffers RuntimeTelemetryEvents and batch-POSTs them to the platform API.
 * Errors are swallowed — telemetry must never crash the runtime.
 */
export class PlatformTelemetrySink {
  private readonly buffer: RuntimeTelemetryEvent[] = [];
  private readonly platformUrl: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    platformUrl: string,
    apiKey: string,
    options?: {batchSize?: number; flushIntervalMs?: number},
  ) {
    this.platformUrl = platformUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  /**
   * Returns a TelemetrySink callback for use with RuntimeTelemetry.
   */
  sink(): TelemetrySink {
    return (event: RuntimeTelemetryEvent) => {
      if (this.destroyed) return;
      this.buffer.push(event);
      if (this.buffer.length >= this.batchSize) {
        void this.flush();
      }
    };
  }

  /**
   * Flush all buffered events to the platform.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);

    try {
      const response = await fetch(`${this.platformUrl}/api/telemetry/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({events}),
      });

      if (!response.ok) {
        // Swallow — telemetry failures must not affect the runtime
      }
    } catch {
      // Swallow network errors
    }
  }

  /**
   * Stop the flush timer and flush remaining events.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Number of events currently buffered (for testing).
   */
  get bufferedCount(): number {
    return this.buffer.length;
  }
}
