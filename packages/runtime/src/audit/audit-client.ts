/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Batching HTTP client that posts audit entries to the platform API.
 * Fire-and-forget — never blocks chat processing.
 */

export interface AuditEntry {
  event: string;
  resource_name: string;
  author?: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface AuditClientOptions {
  /** Platform API base URL */
  platformApiUrl: string;
  /** Flush interval in ms (default 2000) */
  flushIntervalMs?: number;
  /** Max batch size before auto-flush (default 20) */
  maxBatchSize?: number;
}

interface PendingBatch {
  appId: string;
  token: string;
  entries: AuditEntry[];
}

const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_BATCH_SIZE = 20;

export class AuditClient {
  private readonly platformApiUrl: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly pending = new Map<string, PendingBatch>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AuditClientOptions) {
    this.platformApiUrl = options.platformApiUrl;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref();
  }

  /**
   * Queue an audit entry for batched delivery.
   * Fire-and-forget — never throws.
   */
  log(appId: string, token: string, entry: AuditEntry): void {
    const key = `${appId}:${token}`;
    let batch = this.pending.get(key);
    if (!batch) {
      batch = { appId, token, entries: [] };
      this.pending.set(key, batch);
    }
    batch.entries.push({
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    });

    if (batch.entries.length >= this.maxBatchSize) {
      const toSend = batch;
      this.pending.delete(key);
      void this.send(toSend);
    }
  }

  /**
   * Flush all pending batches immediately.
   */
  async flush(): Promise<void> {
    const batches = [...this.pending.values()];
    this.pending.clear();
    await Promise.all(batches.map((b) => this.send(b)));
  }

  /**
   * Stop the flush timer and drain remaining entries.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private async send(batch: PendingBatch): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      await fetch(
        `${this.platformApiUrl}/api/applications/${batch.appId}/audit-logs`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${batch.token}`,
          },
          body: JSON.stringify({ entries: batch.entries }),
        },
      );

      clearTimeout(timer);
    } catch (err) {
      // Fire-and-forget — log but don't throw
      process.stderr.write(
        `[WARN] Failed to send audit batch: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
