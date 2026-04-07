/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {MessageDedupCache} from './dedup-cache.js';

describe('MessageDedupCache', () => {
  let cache: MessageDedupCache;

  beforeEach(() => {
    cache = new MessageDedupCache();
  });

  it('returns false for new messages', () => {
    expect(cache.isDuplicate('telegram', '123')).toBe(false);
  });

  it('returns true for duplicate messages', () => {
    cache.isDuplicate('telegram', '123');
    expect(cache.isDuplicate('telegram', '123')).toBe(true);
  });

  it('treats different message IDs as distinct', () => {
    cache.isDuplicate('telegram', '123');
    expect(cache.isDuplicate('telegram', '456')).toBe(false);
  });

  it('treats different channel types as distinct', () => {
    cache.isDuplicate('telegram', '123');
    expect(cache.isDuplicate('slack', '123')).toBe(false);
  });

  it('tracks cache size', () => {
    cache.isDuplicate('telegram', '1');
    cache.isDuplicate('telegram', '2');
    expect(cache.size).toBe(2);
  });

  it('evicts stale entries when threshold is exceeded', () => {
    // Use a very short TTL for testing
    const shortCache = new MessageDedupCache(1); // 1ms TTL

    // Fill past eviction threshold
    for (let i = 0; i < 1001; i++) {
      shortCache.isDuplicate('telegram', String(i));
    }

    // Wait a tick for TTL to expire
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait
    }

    // Next isDuplicate should trigger eviction
    shortCache.isDuplicate('telegram', 'trigger');
    // Stale entries should be gone (only 'trigger' remains)
    expect(shortCache.size).toBeLessThanOrEqual(2);
  });
});
