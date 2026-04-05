/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Wraps a `StoreBackend` so every successful write emits a `store_updated`
 * event to the runtime event bus. Read operations pass through unchanged.
 *
 * Instrumenting at the backend level (rather than each call site: tools,
 * REST routes, admin file tools, task execution) means we cover every
 * write path through one seam.
 */

import type {
  StoreBackend,
  LoadedStore,
  StoreDocument,
  StoreDocumentMeta,
  StoreListOptions,
  StoreListResult,
  StorePutResult,
  RuntimeEventPayload,
} from '@amodalai/types';

interface StoreEventSink {
  emit: (payload: RuntimeEventPayload) => unknown;
}

export function wrapStoreBackendWithEvents(
  inner: StoreBackend,
  bus: StoreEventSink,
): StoreBackend {
  return {
    initialize(stores: LoadedStore[]): Promise<void> {
      return inner.initialize(stores);
    },

    get(appId: string, store: string, key: string): Promise<StoreDocument | null> {
      return inner.get(appId, store, key);
    },

    list(appId: string, store: string, opts?: StoreListOptions): Promise<StoreListResult> {
      return inner.list(appId, store, opts);
    },

    history(appId: string, store: string, key: string): Promise<StoreDocument[]> {
      return inner.history(appId, store, key);
    },

    async put(
      appId: string,
      store: string,
      key: string,
      payload: Record<string, unknown>,
      meta: Partial<StoreDocumentMeta>,
    ): Promise<StorePutResult> {
      const result = await inner.put(appId, store, key, payload, meta);
      bus.emit({
        type: 'store_updated',
        storeName: store,
        operation: 'put',
      });
      return result;
    },

    async delete(appId: string, store: string, key: string): Promise<boolean> {
      const result = await inner.delete(appId, store, key);
      if (result) {
        bus.emit({
          type: 'store_updated',
          storeName: store,
          operation: 'delete',
        });
      }
      return result;
    },

    async purgeExpired(appId: string, store?: string): Promise<number> {
      const count = await inner.purgeExpired(appId, store);
      if (count > 0) {
        bus.emit({
          type: 'store_updated',
          storeName: store ?? '*',
          operation: 'delete',
          count,
        });
      }
      return count;
    },

    close(): Promise<void> {
      return inner.close();
    },
  };
}
