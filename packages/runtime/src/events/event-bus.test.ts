/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {RuntimeEventBus} from './event-bus.js';

describe('RuntimeEventBus', () => {
  it('assigns monotonic sequence numbers starting at 1', () => {
    const bus = new RuntimeEventBus();
    const a = bus.emit({type: 'session_created', sessionId: 's1', appId: 'local'});
    const b = bus.emit({type: 'session_updated', sessionId: 's1', appId: 'local'});
    const c = bus.emit({type: 'manifest_changed'});
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);
  });

  it('stamps ISO timestamps on every event', () => {
    const bus = new RuntimeEventBus();
    const event = bus.emit({type: 'manifest_changed'});
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('delivers events to all subscribed listeners', () => {
    const bus = new RuntimeEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bus.subscribe(listener1);
    bus.subscribe(listener2);

    bus.emit({type: 'session_created', sessionId: 's1', appId: 'local'});

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery to that listener', () => {
    const bus = new RuntimeEventBus();
    const listener = vi.fn();
    const unsub = bus.subscribe(listener);

    bus.emit({type: 'manifest_changed'});
    unsub();
    bus.emit({type: 'manifest_changed'});

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replays buffered events when sinceSeq is provided', () => {
    const bus = new RuntimeEventBus();
    bus.emit({type: 'session_created', sessionId: 's1', appId: 'local'}); // seq 1
    bus.emit({type: 'session_created', sessionId: 's2', appId: 'local'}); // seq 2
    bus.emit({type: 'session_created', sessionId: 's3', appId: 'local'}); // seq 3

    const listener = vi.fn();
    bus.subscribe(listener, 1);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[0].seq).toBe(2);
    expect(listener.mock.calls[1]?.[0].seq).toBe(3);
  });

  it('ring buffer evicts oldest events past capacity', () => {
    const bus = new RuntimeEventBus({bufferSize: 3});
    for (let i = 0; i < 5; i++) {
      bus.emit({type: 'manifest_changed'});
    }

    const listener = vi.fn();
    bus.subscribe(listener, 0);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[0]?.[0].seq).toBe(3);
    expect(listener.mock.calls[2]?.[0].seq).toBe(5);
  });

  it('a throwing listener does not block other listeners', () => {
    const bus = new RuntimeEventBus();
    const bad = vi.fn(() => { throw new Error('oops'); });
    const good = vi.fn();
    bus.subscribe(bad);
    bus.subscribe(good);

    bus.emit({type: 'manifest_changed'});

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('listenerCount tracks active subscriptions', () => {
    const bus = new RuntimeEventBus();
    expect(bus.listenerCount).toBe(0);
    const unsub1 = bus.subscribe(() => {});
    const unsub2 = bus.subscribe(() => {});
    expect(bus.listenerCount).toBe(2);
    unsub1();
    expect(bus.listenerCount).toBe(1);
    unsub2();
    expect(bus.listenerCount).toBe(0);
  });

  it('preserves event data fields through emit', () => {
    const bus = new RuntimeEventBus();
    const event = bus.emit({
      type: 'store_updated',
      storeName: 'leads',
      operation: 'put',
      count: 5,
    });
    expect(event.type).toBe('store_updated');
    if (event.type === 'store_updated') {
      expect(event.storeName).toBe('leads');
      expect(event.operation).toBe('put');
      expect(event.count).toBe(5);
    }
  });
});
