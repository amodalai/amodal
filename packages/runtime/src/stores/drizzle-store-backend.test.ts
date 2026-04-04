/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle store backend tests.
 *
 * Runs the full behaviour matrix (tenant isolation, concurrent writes,
 * TTL/purge, filter-field validation) against the PGLite-backed factory.
 *
 * A Postgres variant runs only when TEST_POSTGRES_URL is set in the
 * environment — otherwise that `describe` block is skipped. This lets
 * CI stay fast and local devs can opt into the Postgres path.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import type {LoadedStore, StoreBackend} from '@amodalai/core';
import {createPGLiteStoreBackend} from './pglite-store-backend.js';
import {createPostgresStoreBackend} from './postgres-store-backend.js';
import {StoreError} from '../errors.js';

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

const STORES: LoadedStore[] = [
  makeStore(),
  makeStore({name: 'ttl-store', ttl: 1}),
  makeStore({name: 'versioned-store', history: {versions: 3}}),
];

type BackendFactory = () => Promise<{
  backend: StoreBackend;
  cleanup: () => Promise<void>;
}>;

function runSuite(makeBackend: BackendFactory): void {
    let backend: StoreBackend;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const b = await makeBackend();
      backend = b.backend;
      cleanup = b.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    describe('tenant isolation', () => {
      it('same (store, key) across different appIds do not collide', async () => {
        await backend.put('tenant-a', 'test-store', 'shared', {id: 'shared', value: 'A'}, {});
        await backend.put('tenant-b', 'test-store', 'shared', {id: 'shared', value: 'B'}, {});

        const a = await backend.get('tenant-a', 'test-store', 'shared');
        const b = await backend.get('tenant-b', 'test-store', 'shared');

        expect(a?.payload['value']).toBe('A');
        expect(b?.payload['value']).toBe('B');
      });

      it('list only returns the caller\'s appId rows', async () => {
        await backend.put('tenant-a', 'test-store', 'a1', {id: 'a1'}, {});
        await backend.put('tenant-a', 'test-store', 'a2', {id: 'a2'}, {});
        await backend.put('tenant-b', 'test-store', 'b1', {id: 'b1'}, {});

        const resA = await backend.list('tenant-a', 'test-store');
        const resB = await backend.list('tenant-b', 'test-store');

        expect(resA.total).toBe(2);
        expect(resB.total).toBe(1);
        expect(resA.documents.every((d) => d.appId === 'tenant-a')).toBe(true);
        expect(resB.documents.every((d) => d.appId === 'tenant-b')).toBe(true);
      });

      it('delete on one tenant does not affect the other', async () => {
        await backend.put('tenant-a', 'test-store', 'k', {id: 'k'}, {});
        await backend.put('tenant-b', 'test-store', 'k', {id: 'k'}, {});

        await backend.delete('tenant-a', 'test-store', 'k');

        expect(await backend.get('tenant-a', 'test-store', 'k')).toBeNull();
        expect(await backend.get('tenant-b', 'test-store', 'k')).not.toBeNull();
      });
    });

    describe('concurrent writes', () => {
      it('serializes parallel puts to the same key via write queue', async () => {
        // Fire 20 concurrent puts at the same key. The write queue must
        // serialize them so each read-modify-write sees the previous
        // version — final version should be exactly 20.
        const writes = Array.from({length: 20}, (_, i) =>
          backend.put('app', 'test-store', 'same-key', {id: 'same-key', n: i}, {}),
        );
        const results = await Promise.all(writes);

        // All writes reported stored:true
        expect(results.every((r) => r.stored)).toBe(true);

        const final = await backend.get('app', 'test-store', 'same-key');
        expect(final?.version).toBe(20);
      });
    });

    describe('purgeExpired', () => {
      it('removes only expired rows and returns the count', async () => {
        // ttl-store has ttl=1s
        await backend.put('app', 'ttl-store', 'e1', {id: 'e1'}, {});
        await backend.put('app', 'ttl-store', 'e2', {id: 'e2'}, {});
        // Non-TTL store — should never be purged
        await backend.put('app', 'test-store', 'keep', {id: 'keep'}, {});

        // Wait for TTL to elapse
        await new Promise((r) => setTimeout(r, 1100));

        const purged = await backend.purgeExpired('app');
        expect(purged).toBe(2);

        expect(await backend.get('app', 'ttl-store', 'e1')).toBeNull();
        expect(await backend.get('app', 'ttl-store', 'e2')).toBeNull();
        expect(await backend.get('app', 'test-store', 'keep')).not.toBeNull();
      });

      it('scoped purge only touches the named store', async () => {
        await backend.put('app', 'ttl-store', 'a', {id: 'a'}, {});
        await backend.put('app', 'test-store', 'b', {id: 'b'}, {});

        // put with manual expires_at on test-store via TTL=0 is not exposed;
        // instead, verify purgeExpired scoped to ttl-store only affects ttl-store.
        await new Promise((r) => setTimeout(r, 1100));
        const purged = await backend.purgeExpired('app', 'ttl-store');
        expect(purged).toBe(1);
        expect(await backend.get('app', 'test-store', 'b')).not.toBeNull();
      });

      it('excludes expired rows from list() when includeStale is false', async () => {
        await backend.put('app', 'ttl-store', 'x', {id: 'x'}, {});
        await new Promise((r) => setTimeout(r, 1100));

        const defaultList = await backend.list('app', 'ttl-store');
        expect(defaultList.total).toBe(0);

        const withStale = await backend.list('app', 'ttl-store', {includeStale: true});
        expect(withStale.total).toBe(1);
        expect(withStale.documents[0].meta.stale).toBe(true);
      });
    });

    describe('filter-field validation', () => {
      it('rejects filter field names with injection characters', async () => {
        await backend.put('app', 'test-store', 'k', {id: 'k'}, {});
        await expect(
          backend.list('app', 'test-store', {filter: {"'; DROP TABLE store_documents; --": 'x'}}),
        ).rejects.toBeInstanceOf(StoreError);
      });

      it('rejects filter fields containing whitespace or punctuation', async () => {
        await expect(
          backend.list('app', 'test-store', {filter: {'value OR 1=1': 'x'}}),
        ).rejects.toBeInstanceOf(StoreError);
      });

      it('rejects sort field with injection characters', async () => {
        await expect(
          backend.list('app', 'test-store', {sort: "value); DROP TABLE x; --"}),
        ).rejects.toBeInstanceOf(StoreError);
      });

      it('accepts valid snake_case filter field', async () => {
        await backend.put('app', 'test-store', 'k', {id: 'k', my_field: 'yes'}, {});
        const result = await backend.list('app', 'test-store', {filter: {my_field: 'yes'}});
        expect(result.total).toBe(1);
      });
    });

    describe('versioning edge cases', () => {
      it('history respects maxVersions trim', async () => {
        // versioned-store has history.versions=3
        for (let i = 1; i <= 6; i++) {
          await backend.put('app', 'versioned-store', 'k', {id: 'k', n: i}, {});
        }
        const history = await backend.history('app', 'versioned-store', 'k');
        // Current version is 6; history should hold the trailing 3 prior versions (3,4,5)
        expect(history).toHaveLength(3);
        expect(history[0].version).toBe(5);
        expect(history[2].version).toBe(3);
      });
    });
}

// ---------------------------------------------------------------------------
// PGLite suite (always runs)
// ---------------------------------------------------------------------------

describe('DrizzleStoreBackend (PGLite)', () => {
  runSuite(async () => {
    const backend = await createPGLiteStoreBackend(STORES);
    return {
      backend,
      cleanup: () => backend.close(),
    };
  });
});

// ---------------------------------------------------------------------------
// Postgres suite (opt-in via TEST_POSTGRES_URL env var)
// ---------------------------------------------------------------------------

const pgUrl = process.env['TEST_POSTGRES_URL'] ?? '';
const pgDescribe = pgUrl ? describe : describe.skip;

pgDescribe('DrizzleStoreBackend (Postgres, via TEST_POSTGRES_URL)', () => {
  runSuite(async () => {
    // Use a unique schema per test run to isolate from any existing tables.
    const schema = `store_test_${Date.now()}`;
    const backend = await createPostgresStoreBackend(STORES, {
      connectionString: pgUrl,
      schema,
    });
    return {
      backend,
      cleanup: async () => {
        await backend.close();
        // Drop the test schema. Reopen a fresh pool because backend.close()
        // ended the pool it owned.
        const pg = await import('pg');
        const {Pool} = pg.default ?? pg;
        const pool = new Pool({connectionString: pgUrl});
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      },
    };
  });
});
