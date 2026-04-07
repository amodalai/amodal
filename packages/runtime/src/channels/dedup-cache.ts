/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * In-memory dedup cache for channel webhook retries.
 *
 * Messaging platforms may resend webhook payloads when the server
 * doesn't respond with 200 quickly enough. This cache prevents the same
 * message from being processed twice.
 *
 * Keyed by `${channelType}:${messageId}`, with a configurable TTL.
 * Lazy eviction keeps the fast path allocation-free.
 */

const DEFAULT_TTL_MS = 60_000;
const EVICTION_THRESHOLD = 1000;

export class MessageDedupCache {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Returns `true` if this message was already seen (duplicate).
   * Returns `false` and records the message if it's new.
   */
  isDuplicate(channelType: string, messageId: string): boolean {
    const key = `${channelType}:${messageId}`;
    const now = Date.now();

    if (this.seen.size > EVICTION_THRESHOLD) {
      this.evict(now);
    }

    if (this.seen.has(key)) {
      return true;
    }

    this.seen.set(key, now);
    return false;
  }

  get size(): number {
    return this.seen.size;
  }

  private evict(now: number): void {
    for (const [k, ts] of this.seen) {
      if (now - ts > this.ttlMs) {
        this.seen.delete(k);
      }
    }
  }
}
