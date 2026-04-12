/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getEventBus, resetEventBus } from '../event-bus';

describe('StudioEventBus', () => {
  beforeEach(() => {
    resetEventBus();
  });

  it('delivers events to subscribers', () => {
    const bus = getEventBus();
    const received: unknown[] = [];

    bus.subscribe((event) => {
      received.push(event);
    });

    bus.emit('store_updated', { store: 'users', key: 'alice' });

    expect(received).toHaveLength(1);
    const event = received[0] as Record<string, unknown>;
    expect(event.type).toBe('store_updated');
    expect(event.payload).toEqual({ store: 'users', key: 'alice' });
    expect(event.seq).toBe(1);
    expect(typeof event.timestamp).toBe('string');
  });

  it('increments sequence numbers across events', () => {
    const bus = getEventBus();
    const seqs: number[] = [];

    bus.subscribe((event) => {
      seqs.push(event.seq);
    });

    bus.emit('store_updated', {});
    bus.emit('session_updated', {});
    bus.emit('feedback_created', {});

    expect(seqs).toEqual([1, 2, 3]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = getEventBus();
    const received: unknown[] = [];

    const unsub = bus.subscribe((event) => {
      received.push(event);
    });

    bus.emit('store_updated', { first: true });
    unsub();
    bus.emit('store_updated', { second: true });

    expect(received).toHaveLength(1);
  });

  it('delivers to multiple subscribers', () => {
    const bus = getEventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];

    bus.subscribe((event) => a.push(event));
    bus.subscribe((event) => b.push(event));

    bus.emit('feedback_created', { id: '1' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('returns the same singleton instance', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('resetEventBus creates a fresh instance', () => {
    const bus1 = getEventBus();
    resetEventBus();
    const bus2 = getEventBus();
    expect(bus1).not.toBe(bus2);
  });
});
