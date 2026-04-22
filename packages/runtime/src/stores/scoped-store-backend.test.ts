/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {StoreBackend, StoreDocument, StoreDocumentMeta, StorePutResult, StoreListResult, LoadedStore} from '@amodalai/types';
import {ScopedStoreBackend} from './scoped-store-backend.js';
import {StoreError} from '../errors.js';

// ---------------------------------------------------------------------------
// Minimal mock backend
// ---------------------------------------------------------------------------

function makeMockBackend(): StoreBackend {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({stored: true, key: 'k', version: 1} satisfies StorePutResult),
    list: vi.fn().mockResolvedValue({documents: [], total: 0, hasMore: false} satisfies StoreListResult),
    delete: vi.fn().mockResolvedValue(true),
    history: vi.fn().mockResolvedValue([]),
    purgeExpired: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDoc(): StoreDocument {
  return {
    key: 'k',
    appId: 'app',
    store: 'scoped-store',
    version: 1,
    payload: {id: 'k'},
    meta: {} as StoreDocumentMeta,
  };
}

const APP_ID = 'my-app';
const SCOPE_ID = 'user-99';
const SCOPED_STORE = 'scoped-store';
const SHARED_STORE = 'shared-catalog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScopedStoreBackend', () => {
  let inner: StoreBackend;
  let backend: ScopedStoreBackend;

  beforeEach(() => {
    inner = makeMockBackend();
    backend = new ScopedStoreBackend(inner, SCOPE_ID, new Set([SHARED_STORE]));
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('normal store: passes scopeId to inner backend', async () => {
      vi.mocked(inner.get).mockResolvedValueOnce(makeDoc());
      await backend.get(APP_ID, '', SCOPED_STORE, 'k');
      expect(inner.get).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, 'k');
    });

    it('shared store: passes empty scopeId to inner backend', async () => {
      await backend.get(APP_ID, '', SHARED_STORE, 'k');
      expect(inner.get).toHaveBeenCalledWith(APP_ID, '', SHARED_STORE, 'k');
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('normal store: passes scopeId to inner backend', async () => {
      await backend.list(APP_ID, '', SCOPED_STORE);
      expect(inner.list).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, undefined);
    });

    it('shared store: passes empty scopeId to inner backend', async () => {
      await backend.list(APP_ID, '', SHARED_STORE);
      expect(inner.list).toHaveBeenCalledWith(APP_ID, '', SHARED_STORE, undefined);
    });

    it('forwards list options to inner backend', async () => {
      const opts = {filter: {status: 'active'}, limit: 10};
      await backend.list(APP_ID, '', SCOPED_STORE, opts);
      expect(inner.list).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, opts);
    });
  });

  // -------------------------------------------------------------------------
  // put
  // -------------------------------------------------------------------------

  describe('put', () => {
    it('normal store: passes scopeId to inner backend', async () => {
      const payload = {id: 'k', name: 'test'};
      const meta = {computedAt: '2026-01-01T00:00:00Z'} as Partial<StoreDocumentMeta>;
      await backend.put(APP_ID, '', SCOPED_STORE, 'k', payload, meta);
      expect(inner.put).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, 'k', payload, meta);
    });

    it('shared store: throws StoreError', async () => {
      await expect(async () =>
        backend.put(APP_ID, '', SHARED_STORE, 'k', {id: 'k'}, {}),
      ).rejects.toBeInstanceOf(StoreError);
    });

    it('shared store: StoreError message mentions the store name', async () => {
      await expect(async () =>
        backend.put(APP_ID, '', SHARED_STORE, 'k', {id: 'k'}, {}),
      ).rejects.toThrow(SHARED_STORE);
    });

    it('shared store: inner put is never called', async () => {
      await expect(async () =>
        backend.put(APP_ID, '', SHARED_STORE, 'k', {id: 'k'}, {}),
      ).rejects.toBeInstanceOf(StoreError);
      expect(inner.put).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('normal store: passes scopeId to inner backend', async () => {
      await backend.delete(APP_ID, '', SCOPED_STORE, 'k');
      expect(inner.delete).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, 'k');
    });

    it('shared store: throws StoreError', async () => {
      await expect(async () =>
        backend.delete(APP_ID, '', SHARED_STORE, 'k'),
      ).rejects.toBeInstanceOf(StoreError);
    });

    it('shared store: inner delete is never called', async () => {
      await expect(async () =>
        backend.delete(APP_ID, '', SHARED_STORE, 'k'),
      ).rejects.toBeInstanceOf(StoreError);
      expect(inner.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // history
  // -------------------------------------------------------------------------

  describe('history', () => {
    it('normal store: passes scopeId to inner backend', async () => {
      await backend.history(APP_ID, '', SCOPED_STORE, 'k');
      expect(inner.history).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE, 'k');
    });

    it('shared store: passes empty scopeId to inner backend', async () => {
      await backend.history(APP_ID, '', SHARED_STORE, 'k');
      expect(inner.history).toHaveBeenCalledWith(APP_ID, '', SHARED_STORE, 'k');
    });
  });

  // -------------------------------------------------------------------------
  // Delegation — initialize, close, purgeExpired
  // -------------------------------------------------------------------------

  describe('initialize', () => {
    it('delegates to inner backend', async () => {
      const stores: LoadedStore[] = [];
      await backend.initialize(stores);
      expect(inner.initialize).toHaveBeenCalledWith(stores);
    });
  });

  describe('close', () => {
    it('delegates to inner backend', async () => {
      await backend.close();
      expect(inner.close).toHaveBeenCalled();
    });
  });

  describe('purgeExpired', () => {
    it('delegates to inner backend with the provided args', async () => {
      vi.mocked(inner.purgeExpired).mockResolvedValueOnce(5);
      const count = await backend.purgeExpired(APP_ID, SCOPE_ID, SCOPED_STORE);
      expect(inner.purgeExpired).toHaveBeenCalledWith(APP_ID, SCOPE_ID, SCOPED_STORE);
      expect(count).toBe(5);
    });

    it('delegates purgeExpired without a store name', async () => {
      await backend.purgeExpired(APP_ID, SCOPE_ID);
      expect(inner.purgeExpired).toHaveBeenCalledWith(APP_ID, SCOPE_ID, undefined);
    });
  });
});
