/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Client-side React context that opens an EventSource to the SSE
 * endpoint and dispatches events to subscribers.
 */

import { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { studioApiUrl } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const STUDIO_EVENT_TYPES = [
  'store_updated',
  'session_updated',
  'feedback_created',
  'automation_started',
  'automation_completed',
] as const;

export type StudioEventType = (typeof STUDIO_EVENT_TYPES)[number];

export type EventHandler = (payload: unknown) => void;

export interface StudioEventsContextValue {
  subscribe(types: StudioEventType[], handler: EventHandler): () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SSE_ENDPOINT_PATH = '/api/events';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const StudioEventsContext = createContext<StudioEventsContextValue>({
  subscribe: () => () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function StudioEventsProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef(new Map<StudioEventType, Set<EventHandler>>());

  useEffect(() => {
    const es = new EventSource(studioApiUrl(SSE_ENDPOINT_PATH));

    for (const type of STUDIO_EVENT_TYPES) {
      es.addEventListener(type, (e: MessageEvent) => {
        const handlers = listenersRef.current.get(type);
        if (!handlers) return;

        let payload: unknown;
        const rawData: unknown = e.data;
        try {
          payload = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        } catch {
          payload = rawData;
        }

        for (const handler of handlers) {
          handler(payload);
        }
      });
    }

    return () => {
      es.close();
    };
  }, []);

  const subscribe = useCallback(
    (types: StudioEventType[], handler: EventHandler): (() => void) => {
      for (const type of types) {
        if (!listenersRef.current.has(type)) {
          listenersRef.current.set(type, new Set());
        }
        listenersRef.current.get(type)!.add(handler);
      }
      return () => {
        for (const type of types) {
          listenersRef.current.get(type)?.delete(handler);
        }
      };
    },
    [],
  );

  return (
    <StudioEventsContext.Provider value={{ subscribe }}>
      {children}
    </StudioEventsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribe to real-time Studio events. The handler is called whenever
 * any of the specified event types fire.
 *
 * @example
 * ```tsx
 * useStudioEvents(['store_updated'], (payload) => {
 *   console.log('Store updated:', payload);
 * });
 * ```
 */
export function useStudioEvents(types: StudioEventType[], handler: EventHandler): void {
  const { subscribe } = useContext(StudioEventsContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() =>
    subscribe(types, (payload) => handlerRef.current(payload))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [subscribe, ...types]);
}
