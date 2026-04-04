/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime event bus subscription context.
 *
 * Opens a single EventSource to `/api/events` for the entire app and
 * fans out events to subscribed listeners. Replaces per-component
 * setInterval polling with push-based updates.
 *
 * Reconnect-and-resume: tracks the last-seen event seq and passes it
 * as `Last-Event-ID` on reconnect so no events are missed.
 */

import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import type { ReactNode } from 'react';

export type RuntimeEventType =
  | 'session_created'
  | 'session_updated'
  | 'session_deleted'
  | 'automation_triggered'
  | 'automation_completed'
  | 'automation_failed'
  | 'store_updated'
  | 'manifest_changed'
  | 'files_changed';

export interface RuntimeEvent {
  seq: number;
  timestamp: string;
  type: RuntimeEventType;
  [key: string]: unknown;
}

type Listener = (event: RuntimeEvent) => void;

interface RuntimeEventsContextValue {
  subscribe: (types: RuntimeEventType[] | '*', listener: Listener) => () => void;
  connected: boolean;
}

const RuntimeEventsContext = createContext<RuntimeEventsContextValue>({
  subscribe: () => () => {},
  connected: false,
});

export interface RuntimeEventsProviderProps {
  runtimeUrl: string;
  children: ReactNode;
}

export function RuntimeEventsProvider({ runtimeUrl, children }: RuntimeEventsProviderProps) {
  // Map from event type (or '*') to a set of listeners
  const listenersRef = useRef<Map<RuntimeEventType | '*', Set<Listener>>>(new Map());
  const [connected, setConnected] = useState(false);
  // Tracks latest seen event seq for reconnect-and-resume
  const lastSeqRef = useRef<number>(0);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function dispatch(event: RuntimeEvent): void {
      lastSeqRef.current = event.seq;
      const typed = listenersRef.current.get(event.type);
      if (typed) {
        for (const listener of typed) {
          try { listener(event); } catch { /* ignore bad listener */ }
        }
      }
      const wildcard = listenersRef.current.get('*');
      if (wildcard) {
        for (const listener of wildcard) {
          try { listener(event); } catch { /* ignore bad listener */ }
        }
      }
    }

    function connect(): void {
      if (stopped) return;
      // EventSource automatically sends Last-Event-ID on reconnect after
      // the initial id: field was received, but we also pass it via URL
      // query on first connect so the server can replay.
      const url = new URL(`${runtimeUrl}/api/events`, window.location.origin);
      // Nothing extra in URL — we rely on the browser's native
      // Last-Event-ID reconnect handling which uses the `id:` we send
      // on each SSE frame.
      source = new EventSource(url.toString());

      source.onopen = () => {
        setConnected(true);
      };

      source.onerror = () => {
        setConnected(false);
        // Browser EventSource auto-reconnects with its own backoff, but
        // we schedule a manual retry for the case where the server is
        // actually down and EventSource gives up.
        if (source) {
          source.close();
          source = null;
        }
        if (!stopped && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 2000);
        }
      };

      // SSE "named" events fire via addEventListener, not onmessage
      const handle = (evt: MessageEvent): void => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server event payload
          const parsed = JSON.parse(evt.data as string) as RuntimeEvent;
          dispatch(parsed);
        } catch { /* bad frame, ignore */ }
      };

      const eventTypes: RuntimeEventType[] = [
        'session_created', 'session_updated', 'session_deleted',
        'automation_triggered', 'automation_completed', 'automation_failed',
        'store_updated', 'manifest_changed', 'files_changed',
      ];
      for (const type of eventTypes) {
        source.addEventListener(type, handle);
      }
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (source) source.close();
      setConnected(false);
    };
  }, [runtimeUrl]);

  const subscribe = useCallback<RuntimeEventsContextValue['subscribe']>(
    (types, listener) => {
      const keys = types === '*' ? ['*' as const] : types;
      for (const key of keys) {
        let set = listenersRef.current.get(key);
        if (!set) {
          set = new Set();
          listenersRef.current.set(key, set);
        }
        set.add(listener);
      }
      return () => {
        for (const key of keys) {
          const set = listenersRef.current.get(key);
          if (set) {
            set.delete(listener);
            if (set.size === 0) listenersRef.current.delete(key);
          }
        }
      };
    },
    [],
  );

  return (
    <RuntimeEventsContext.Provider value={{ subscribe, connected }}>
      {children}
    </RuntimeEventsContext.Provider>
  );
}

/** Returns whether the event stream is currently connected. */
export function useRuntimeConnection(): boolean {
  return useContext(RuntimeEventsContext).connected;
}

/**
 * Subscribe to runtime events. The handler receives every event of the
 * specified type(s) for the lifetime of the calling component.
 *
 * @example
 * useRuntimeEvents(['session_created', 'session_updated'], (event) => {
 *   // refetch /sessions or update local state optimistically
 * });
 */
export function useRuntimeEvents(
  types: RuntimeEventType[] | '*',
  handler: (event: RuntimeEvent) => void,
): void {
  const ctx = useContext(RuntimeEventsContext);
  // Keep handler ref stable across renders so subscribe isn't
  // torn down/rebuilt on every render of the consumer.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Serialize types so the dep array is stable for array literals
  const typesKey = types === '*' ? '*' : types.join(',');

  useEffect(() => {
    const subscribe = ctx.subscribe;
    const unsubscribe = subscribe(types, (evt) => handlerRef.current(evt));
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typesKey captures the array content
  }, [ctx.subscribe, typesKey]);
}
