/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import type {StoreBackend} from '@amodalai/types';
import {wrapStoreBackendWithEvents} from './store-event-wrapper.js';
import {RuntimeEventBus} from './event-bus.js';

function makeStubBackend(overrides: Partial<StoreBackend> = {}): StoreBackend {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({rows: [], total: 0}),
    history: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue({version: 1, stale: false}),
    delete: vi.fn().mockResolvedValue(true),
    purgeExpired: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('wrapStoreBackendWithEvents', () => {
  it('emits store_updated on successful put', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<{type: string; storeName: unknown; operation: unknown}> = [];
    bus.subscribe((e) => emits.push({type: e.type, storeName: (e as {storeName?: unknown}).storeName, operation: (e as {operation?: unknown}).operation}));

    const wrapped = wrapStoreBackendWithEvents(makeStubBackend(), bus);
    await wrapped.put('local', '', 'leads', 'k1', {x: 1}, {});

    expect(emits).toHaveLength(1);
    expect(emits[0]).toEqual({type: 'store_updated', storeName: 'leads', operation: 'put'});
  });

  it('emits store_updated on successful delete', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const wrapped = wrapStoreBackendWithEvents(makeStubBackend(), bus);
    await wrapped.delete('local', '', 'leads', 'k1');

    expect(emits).toHaveLength(1);
    expect(emits[0]?.['type']).toBe('store_updated');
    expect(emits[0]?.['operation']).toBe('delete');
  });

  it('does NOT emit on delete that returns false (not found)', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const wrapped = wrapStoreBackendWithEvents(
      makeStubBackend({delete: vi.fn().mockResolvedValue(false)}),
      bus,
    );
    await wrapped.delete('local', '', 'leads', 'missing');

    expect(emits).toHaveLength(0);
  });

  it('emits store_updated with count on purgeExpired', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const wrapped = wrapStoreBackendWithEvents(
      makeStubBackend({purgeExpired: vi.fn().mockResolvedValue(3)}),
      bus,
    );
    await wrapped.purgeExpired('local', '', 'leads');

    expect(emits).toHaveLength(1);
    expect(emits[0]?.['count']).toBe(3);
    expect(emits[0]?.['storeName']).toBe('leads');
  });

  it('does NOT emit on purgeExpired that deletes nothing', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const wrapped = wrapStoreBackendWithEvents(makeStubBackend(), bus);
    await wrapped.purgeExpired('local', '');

    expect(emits).toHaveLength(0);
  });

  it('passes read operations through unchanged without emitting', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const inner = makeStubBackend();
    const wrapped = wrapStoreBackendWithEvents(inner, bus);

    await wrapped.get('local', '', 'leads', 'k1');
    await wrapped.list('local', '', 'leads');
    await wrapped.history('local', '', 'leads', 'k1');

    expect(emits).toHaveLength(0);
    expect(inner.get).toHaveBeenCalled();
    expect(inner.list).toHaveBeenCalled();
    expect(inner.history).toHaveBeenCalled();
  });

  it('propagates put/delete errors without emitting', async () => {
    const bus = new RuntimeEventBus();
    const emits: Array<Record<string, unknown>> = [];
    bus.subscribe((e) => emits.push(e as unknown as Record<string, unknown>));

    const wrapped = wrapStoreBackendWithEvents(
      makeStubBackend({put: vi.fn().mockRejectedValue(new Error('disk full'))}),
      bus,
    );

    await expect(wrapped.put('local', '', 'leads', 'k1', {}, {})).rejects.toThrow('disk full');
    expect(emits).toHaveLength(0);
  });
});
