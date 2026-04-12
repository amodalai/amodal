/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * In-process event bus that bridges Postgres notifications to SSE subscribers.
 *
 * The event bus is a singleton that receives events from the Postgres
 * LISTEN/NOTIFY bridge and fans them out to all connected SSE clients.
 */

import { EventEmitter } from 'node:events';
import type { NotifyChannel } from '@amodalai/db';

export type StudioEventType = NotifyChannel;

export interface StudioEvent {
  type: StudioEventType;
  payload: unknown;
  timestamp: string;
}

export interface SequencedStudioEvent extends StudioEvent {
  seq: number;
}

class StudioEventBus {
  private emitter = new EventEmitter();
  private seq = 0;

  emit(type: StudioEventType, payload: unknown): void {
    this.seq++;
    const event: SequencedStudioEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
      seq: this.seq,
    };
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: SequencedStudioEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => {
      this.emitter.off('event', handler);
    };
  }
}

let bus: StudioEventBus | null = null;

export function getEventBus(): StudioEventBus {
  if (!bus) bus = new StudioEventBus();
  return bus;
}

/**
 * Reset the singleton event bus. Used for testing only.
 */
export function resetEventBus(): void {
  bus = null;
}
