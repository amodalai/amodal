/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { TypedEventEmitter } from '../client/EventEmitter';

interface TestEvents {
  message: string;
  count: number;
  data: { x: number; y: string };
  empty: undefined;
}

/** Subclass to expose emit for testing. */
class TestEmitter extends TypedEventEmitter<TestEvents> {
  override emit<K extends keyof TestEvents>(event: K, data: TestEvents[K]): void {
    super.emit(event, data);
  }
}

describe('TypedEventEmitter', () => {
  it('registers and calls listeners on emit', () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.emit('message', 'hello');

    expect(handler).toHaveBeenCalledExactlyOnceWith('hello');
  });

  it('supports multiple listeners for the same event', () => {
    const emitter = new TestEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('count', handler1);
    emitter.on('count', handler2);
    emitter.emit('count', 42);

    expect(handler1).toHaveBeenCalledWith(42);
    expect(handler2).toHaveBeenCalledWith(42);
  });

  it('off() removes a specific listener', () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.off('message', handler);
    emitter.emit('message', 'should not receive');

    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners() clears all listeners', () => {
    const emitter = new TestEmitter();
    const msgHandler = vi.fn();
    const countHandler = vi.fn();

    emitter.on('message', msgHandler);
    emitter.on('count', countHandler);
    emitter.removeAllListeners();

    emitter.emit('message', 'test');
    emitter.emit('count', 1);

    expect(msgHandler).not.toHaveBeenCalled();
    expect(countHandler).not.toHaveBeenCalled();
  });

  it('returns this from on() and off() for chaining', () => {
    const emitter = new TestEmitter();
    const handler = vi.fn();

    const onResult = emitter.on('message', handler);
    expect(onResult).toBe(emitter);

    const offResult = emitter.off('message', handler);
    expect(offResult).toBe(emitter);
  });

  it('returns this from removeAllListeners() for chaining', () => {
    const emitter = new TestEmitter();
    const result = emitter.removeAllListeners();
    expect(result).toBe(emitter);
  });

  it('handles events with different data types', () => {
    const emitter = new TestEmitter();
    const dataHandler = vi.fn();
    const emptyHandler = vi.fn();

    emitter.on('data', dataHandler);
    emitter.on('empty', emptyHandler);

    emitter.emit('data', { x: 10, y: 'hello' });
    emitter.emit('empty', undefined);

    expect(dataHandler).toHaveBeenCalledWith({ x: 10, y: 'hello' });
    expect(emptyHandler).toHaveBeenCalledWith(undefined);
  });

  it('does not error when emitting with no listeners', () => {
    const emitter = new TestEmitter();

    // Should not throw
    expect(() => {
      emitter.emit('message', 'no listeners');
      emitter.emit('count', 0);
    }).not.toThrow();
  });
});
