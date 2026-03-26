/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import type {LoadedStore} from '@amodalai/core';
import {PGLiteStoreBackend} from './pglite-store-backend.js';

const TENANT = 'test-tenant';

function makeStore(overrides: Partial<LoadedStore> = {}): LoadedStore {
  return {
    name: 'test-store',
    entity: {
      name: 'TestEntity',
      key: '{id}',
      schema: {
        id: {type: 'string'},
        value: {type: 'string'},
      },
    },
    location: '/test/stores/test-store.json',
    ...overrides,
  };
}

describe('PGLiteStoreBackend', () => {
  let backend: PGLiteStoreBackend;

  beforeEach(async () => {
    // In-memory PGLite (no dataDir)
    backend = new PGLiteStoreBackend();
    await backend.initialize([
      makeStore(),
      makeStore({
        name: 'versioned-store',
        history: {versions: 2},
      }),
      makeStore({
        name: 'ttl-store',
        ttl: 3600,
      }),
    ]);
  });

  afterEach(async () => {
    await backend.close();
  });

  describe('get', () => {
    it('returns null for non-existent document', async () => {
      const doc = await backend.get(TENANT, 'test-store', 'missing');
      expect(doc).toBeNull();
    });

    it('returns a stored document', async () => {
      await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1', value: 'hello'}, {});
      const doc = await backend.get(TENANT, 'test-store', 'key-1');
      expect(doc).not.toBeNull();
      expect(doc?.payload).toEqual({id: 'key-1', value: 'hello'});
      expect(doc?.version).toBe(1);
    });
  });

  describe('put', () => {
    it('creates a new document with version 1', async () => {
      const result = await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1', value: 'v1'}, {});
      expect(result.stored).toBe(true);
      expect(result.version).toBe(1);
      expect(result.previousVersion).toBeUndefined();
    });

    it('increments version on update', async () => {
      await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1', value: 'v1'}, {});
      const result = await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1', value: 'v2'}, {});
      expect(result.version).toBe(2);
      expect(result.previousVersion).toBe(1);
    });

    it('stores metadata', async () => {
      await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1'}, {
        automationId: 'auto-1',
        skillId: 'skill-1',
      });
      const doc = await backend.get(TENANT, 'test-store', 'key-1');
      expect(doc?.meta.automationId).toBe('auto-1');
      expect(doc?.meta.skillId).toBe('skill-1');
      expect(doc?.meta.computedAt).toBeDefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await backend.put(TENANT, 'test-store', 'a', {id: 'a', value: 'alpha'}, {});
      await backend.put(TENANT, 'test-store', 'b', {id: 'b', value: 'beta'}, {});
      await backend.put(TENANT, 'test-store', 'c', {id: 'c', value: 'gamma'}, {});
    });

    it('lists all documents', async () => {
      const result = await backend.list(TENANT, 'test-store');
      expect(result.documents).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('filters by field value', async () => {
      const result = await backend.list(TENANT, 'test-store', {
        filter: {value: 'beta'},
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].payload['value']).toBe('beta');
    });

    it('respects limit and offset', async () => {
      const page1 = await backend.list(TENANT, 'test-store', {limit: 2, offset: 0});
      expect(page1.documents).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await backend.list(TENANT, 'test-store', {limit: 2, offset: 2});
      expect(page2.documents).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('returns empty for unknown store', async () => {
      const result = await backend.list(TENANT, 'nonexistent');
      expect(result.documents).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('delete', () => {
    it('deletes an existing document', async () => {
      await backend.put(TENANT, 'test-store', 'key-1', {id: 'key-1'}, {});
      await backend.delete(TENANT, 'test-store', 'key-1');
      // Verify doc is gone
      const doc = await backend.get(TENANT, 'test-store', 'key-1');
      expect(doc).toBeNull();
    });
  });

  describe('history', () => {
    it('stores version history', async () => {
      await backend.put(TENANT, 'versioned-store', 'key-1', {id: 'key-1', value: 'v1'}, {});
      await backend.put(TENANT, 'versioned-store', 'key-1', {id: 'key-1', value: 'v2'}, {});
      await backend.put(TENANT, 'versioned-store', 'key-1', {id: 'key-1', value: 'v3'}, {});

      const versions = await backend.history(TENANT, 'versioned-store', 'key-1');
      // maxVersions=2, so only versions 1 and 2 are in history (v3 is current)
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(2);
      expect(versions[1].version).toBe(1);
    });

    it('returns empty array when no history', async () => {
      const versions = await backend.history(TENANT, 'test-store', 'missing');
      expect(versions).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('isolates data between tenants', async () => {
      await backend.put('tenant-a', 'test-store', 'key-1', {id: 'key-1', value: 'a'}, {});
      await backend.put('tenant-b', 'test-store', 'key-1', {id: 'key-1', value: 'b'}, {});

      const docA = await backend.get('tenant-a', 'test-store', 'key-1');
      const docB = await backend.get('tenant-b', 'test-store', 'key-1');

      expect(docA?.payload['value']).toBe('a');
      expect(docB?.payload['value']).toBe('b');
    });
  });
});
