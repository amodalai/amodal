/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Minimal typed event emitter with no external dependencies.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic event map constraint
export class TypedEventEmitter<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<(data: never) => void>>();

  on<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (data: never) => void);
    return this;
  }

  off<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as (data: never) => void);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generic event dispatch
        (listener as (data: Events[K]) => void)(data);
      }
    }
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }
}
