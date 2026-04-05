/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime event bus.
 *
 * Centralized pub/sub for server-level state changes (session created,
 * automation triggered, store updated, manifest reloaded). Clients
 * subscribe via the `/api/events` SSE endpoint and use these events to
 * drive live UI updates instead of polling.
 *
 * Each event gets a monotonic sequence number assigned at emit time.
 * A ring buffer of recent events lets reconnecting clients catch up
 * via the `Last-Event-ID` SSE header without missing any state changes.
 */

import type {
  RuntimeEvent,
  RuntimeEventPayload,
} from '@amodalai/types';

/** Maximum number of events kept in the replay buffer */
const DEFAULT_BUFFER_SIZE = 200;

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export interface EventBusOptions {
  /** Max events retained for reconnect-and-resume. Default 200. */
  bufferSize?: number;
  /**
   * Called when a listener throws. The bus never rethrows listener errors
   * (one bad subscriber shouldn't break the broadcast to others), but a
   * throwing listener is a bug worth surfacing. Wire this to a logger.
   */
  onListenerError?: (err: unknown, event: RuntimeEvent) => void;
}

export class RuntimeEventBus {
  private listeners = new Set<RuntimeEventListener>();
  private seq = 0;
  private readonly bufferSize: number;
  private readonly onListenerError: EventBusOptions['onListenerError'];
  private buffer: RuntimeEvent[] = [];

  constructor(options: EventBusOptions = {}) {
    this.bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
    this.onListenerError = options.onListenerError;
  }

  /**
   * Emit an event. The bus assigns `seq` and `timestamp`.
   * Returns the fully-populated event.
   */
  emit(payload: RuntimeEventPayload): RuntimeEvent {
    this.seq += 1;
    // The payload's discriminant `type` field carries through; we only
    // add `seq` and `timestamp`. Shape-preserving by construction.
    const event = {
      ...payload,
      seq: this.seq,
      timestamp: new Date().toISOString(),
    } as RuntimeEvent;

    // Append to ring buffer
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    // Fan out to listeners. Errors in one listener must not break the
    // broadcast to others — so we catch, surface via `onListenerError`
    // (for observability), and continue. Not a silent swallow: the
    // caller sees every failure via the injected callback.
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.onListenerError?.(err, event);
      }
    }

    return event;
  }

  /**
   * Subscribe to events. Returns an unsubscribe function.
   *
   * If `sinceSeq` is provided, buffered events with `seq > sinceSeq`
   * are delivered synchronously before the listener starts receiving
   * live events. Used for reconnect-and-resume.
   */
  subscribe(listener: RuntimeEventListener, sinceSeq?: number): () => void {
    if (sinceSeq !== undefined) {
      for (const event of this.buffer) {
        if (event.seq > sinceSeq) {
          try {
            listener(event);
          } catch (err) {
            this.onListenerError?.(err, event);
          }
        }
      }
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Count of currently subscribed listeners (for observability) */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Current sequence number (for tests + observability) */
  get currentSeq(): number {
    return this.seq;
  }
}
