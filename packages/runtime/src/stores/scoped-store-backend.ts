/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * ScopedStoreBackend — wraps a StoreBackend and enforces scope isolation.
 *
 * Shared stores (marked with `shared: true` in the store JSON) are readable
 * by all scopes but write-protected. Scoped stores read and write with the
 * provided scopeId for per-user isolation.
 *
 * Scope resolution:
 * - Reads (get, list, history): use '' for shared stores, scopeId otherwise
 * - Writes (put, delete): throw StoreError for shared stores (read-only)
 * - purgeExpired/initialize/close: delegate directly, no scope resolution
 */

import type {StoreBackend, StoreDocument, StoreDocumentMeta, StorePutResult, StoreListResult, StoreListOptions, LoadedStore} from '@amodalai/types';
import {StoreError} from '../errors.js';

export class ScopedStoreBackend implements StoreBackend {
  constructor(
    private readonly inner: StoreBackend,
    private readonly scopeId: string,
    private readonly sharedStores: Set<string>,
  ) {}

  // ---------------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------------

  /** Resolve the scopeId to use for read operations. Shared stores always use ''. */
  private readScopeId(store: string): string {
    return this.sharedStores.has(store) ? '' : this.scopeId;
  }

  /** Assert a store is writable (not shared). Throws StoreError otherwise. */
  private assertWritable(store: string, operation: string): void {
    if (this.sharedStores.has(store)) {
      throw new StoreError(
        `Store "${store}" is shared (read-only) — writes are not allowed`,
        {store, operation, context: {scopeId: this.scopeId}},
      );
    }
  }

  // ---------------------------------------------------------------------------
  // StoreBackend implementation
  // ---------------------------------------------------------------------------

  initialize(stores: LoadedStore[]): Promise<void> {
    return this.inner.initialize(stores);
  }

  get(appId: string, _scopeId: string, store: string, key: string): Promise<StoreDocument | null> {
    return this.inner.get(appId, this.readScopeId(store), store, key);
  }

  put(
    appId: string,
    _scopeId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult> {
    this.assertWritable(store, 'put');
    return this.inner.put(appId, this.scopeId, store, key, payload, meta);
  }

  list(
    appId: string,
    _scopeId: string,
    store: string,
    options?: StoreListOptions,
  ): Promise<StoreListResult> {
    return this.inner.list(appId, this.readScopeId(store), store, options);
  }

  delete(appId: string, _scopeId: string, store: string, key: string): Promise<boolean> {
    this.assertWritable(store, 'delete');
    return this.inner.delete(appId, this.scopeId, store, key);
  }

  history(appId: string, _scopeId: string, store: string, key: string): Promise<StoreDocument[]> {
    return this.inner.history(appId, this.readScopeId(store), store, key);
  }

  purgeExpired(appId: string, scopeId: string, store?: string): Promise<number> {
    return this.inner.purgeExpired(appId, scopeId, store);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
