/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useCallback } from 'react';
import type { WidgetEventBus } from '../events/event-bus';
import type { WidgetEventMap, WidgetEvent } from '../events/types';

type Unsubscribe = () => void;

export interface UseWidgetEventsReturn {
  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on: <K extends keyof WidgetEventMap>(
    event: K,
    listener: (data: WidgetEventMap[K]) => void,
  ) => Unsubscribe;
  /** Subscribe to all events. Returns unsubscribe function. */
  onAny: (listener: (data: WidgetEvent) => void) => Unsubscribe;
}

/**
 * React hook for subscribing to widget events with automatic cleanup on unmount.
 * Subscriptions created via `on` / `onAny` are tracked and removed when the
 * component unmounts.
 */
export function useWidgetEvents(eventBus: WidgetEventBus | null | undefined): UseWidgetEventsReturn {
  // Track all active subscriptions for cleanup
  const subscriptions = useRef<Array<() => void>>([]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      for (const unsub of subscriptions.current) {
        unsub();
      }
      subscriptions.current = [];
    },
    [],
  );

  const on = useCallback(
    <K extends keyof WidgetEventMap>(
      event: K,
      listener: (data: WidgetEventMap[K]) => void,
    ): Unsubscribe => {
      if (!eventBus) {
        return () => {};
      }
      eventBus.on(event, listener);
      const unsub = () => {
        eventBus.off(event, listener);
      };
      subscriptions.current.push(unsub);
      return unsub;
    },
    [eventBus],
  );

  const onAny = useCallback(
    (listener: (data: WidgetEvent) => void): Unsubscribe => {
      if (!eventBus) {
        return () => {};
      }
      eventBus.on('*', listener);
      const unsub = () => {
        eventBus.off('*', listener);
      };
      subscriptions.current.push(unsub);
      return unsub;
    },
    [eventBus],
  );

  return { on, onAny };
}
