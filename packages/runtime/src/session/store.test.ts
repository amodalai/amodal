/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared session-store tests.
 *
 * Runs the full behaviour matrix (save/load, upsert, tenant isolation,
 * pagination, metadata filters, hooks, cleanup) against the PGLite
 * backend by default.
 *
 * A Postgres variant runs only when TEST_POSTGRES_URL is set in the
 * environment — mirrors the pattern in `stores/drizzle-store-backend.test.ts`.
 * This keeps CI fast and local devs can opt into the Postgres path with:
 *
 *   TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5433/amodal_test pnpm test
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {PGLiteSessionStore} from './store.js';
import {PostgresSessionStore} from './postgres-store.js';
import type {SessionStore, SessionStoreHooks} from './store.js';
import type {PersistedSession} from './types.js';
import {SessionStoreError} from '../errors.js';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:session-store'});

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    version: 1,
    id: `sess-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: 'tenant-1',
    userId: 'user-1',
    messages: [{role: 'user', content: 'Hello'}],
    tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BackendHandle {
  store: SessionStore;
  cleanup: () => Promise<void>;
  makeWithHooks: (hooks: SessionStoreHooks) => Promise<{
    store: SessionStore;
    cleanup: () => Promise<void>;
  }>;
}

type BackendFactory = () => Promise<BackendHandle>;

function runSuite(makeBackend: BackendFactory): void {
  let store: SessionStore;
  let cleanup: () => Promise<void>;
  let makeWithHooks: BackendHandle['makeWithHooks'];

  beforeEach(async () => {
    const b = await makeBackend();
    store = b.store;
    cleanup = b.cleanup;
    makeWithHooks = b.makeWithHooks;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('save / load / upsert', () => {
    it('saves and loads a session with all fields intact', async () => {
      const session = makeSession({
        messages: [
          {role: 'user', content: 'Hi'},
          {role: 'assistant', content: 'Hello there'},
        ],
        tokenUsage: {inputTokens: 42, outputTokens: 7, totalTokens: 49},
        metadata: {title: 'Test', provider: 'anthropic'},
      });
      await store.save(session);

      const loaded = await store.load(session.tenantId, session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.tenantId).toBe(session.tenantId);
      expect(loaded!.userId).toBe(session.userId);
      expect(loaded!.version).toBe(1);
      expect(loaded!.messages).toEqual(session.messages);
      expect(loaded!.tokenUsage).toEqual(session.tokenUsage);
      expect(loaded!.metadata).toEqual(session.metadata);
    });

    it('returns null for a missing session', async () => {
      expect(await store.load('tenant-1', 'nonexistent')).toBeNull();
    });

    it('save updates an existing session (upsert) and refreshes fields', async () => {
      const session = makeSession();
      await store.save(session);

      session.messages = [...session.messages, {role: 'assistant', content: 'Hi'}];
      session.tokenUsage = {inputTokens: 200, outputTokens: 100, totalTokens: 300};
      session.updatedAt = new Date(Date.now() + 1000);
      await store.save(session);

      const loaded = await store.load(session.tenantId, session.id);
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.tokenUsage.totalTokens).toBe(300);
    });

    it('preserves rich metadata round-trip', async () => {
      const session = makeSession({
        metadata: {
          title: 'Complex session',
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          appId: 'my-app',
          automationName: 'nightly-digest',
          custom: {nested: {deeply: [1, 2, 3]}},
        },
      });
      await store.save(session);
      const loaded = await store.load(session.tenantId, session.id);
      expect(loaded!.metadata).toEqual(session.metadata);
    });
  });

  describe('tenant isolation', () => {
    it('list only returns sessions for the requested tenant', async () => {
      const a = `tenant-a-${Date.now()}`;
      const b = `tenant-b-${Date.now()}`;
      await store.save(makeSession({tenantId: a}));
      await store.save(makeSession({tenantId: a}));
      await store.save(makeSession({tenantId: b}));

      const {sessions: sessionsA} = await store.list(a);
      const {sessions: sessionsB} = await store.list(b);
      expect(sessionsA).toHaveLength(2);
      expect(sessionsB).toHaveLength(1);
      expect(sessionsA.every((s) => s.tenantId === a)).toBe(true);
    });

    it('load returns null when tenantId does not match the row', async () => {
      // SQL-level enforcement: a caller with the wrong tenant cannot
      // read another tenant's session, even with the correct sessionId.
      const session = makeSession({tenantId: 'tenant-owner'});
      await store.save(session);

      // Correct tenant → found
      const asOwner = await store.load('tenant-owner', session.id);
      expect(asOwner).not.toBeNull();

      // Wrong tenant → null
      const asOther = await store.load('tenant-intruder', session.id);
      expect(asOther).toBeNull();
    });

    it('delete is a no-op when tenantId does not match', async () => {
      const session = makeSession({tenantId: 'tenant-owner'});
      await store.save(session);

      // Wrong tenant → delete returns false and leaves the row intact
      const deletedByIntruder = await store.delete('tenant-intruder', session.id);
      expect(deletedByIntruder).toBe(false);
      expect(await store.load('tenant-owner', session.id)).not.toBeNull();

      // Correct tenant → delete succeeds
      const deletedByOwner = await store.delete('tenant-owner', session.id);
      expect(deletedByOwner).toBe(true);
    });
  });

  describe('list — ordering', () => {
    it('returns sessions newest first', async () => {
      const tenantId = `tenant-order-${Date.now()}`;
      const older = makeSession({tenantId, updatedAt: new Date('2026-01-01')});
      const newer = makeSession({tenantId, updatedAt: new Date('2026-03-01')});
      await store.save(older);
      await store.save(newer);

      const {sessions} = await store.list(tenantId);
      const ids = sessions.map((s) => s.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });
  });

  describe('list — pagination', () => {
    it('returns nextCursor when more rows exist, null when page is final', async () => {
      const tenantId = `tenant-page-${Date.now()}`;
      for (let i = 0; i < 5; i++) {
        await store.save(
          makeSession({tenantId, updatedAt: new Date(2026, 0, 1 + i)}),
        );
      }

      const page1 = await store.list(tenantId, {limit: 2});
      expect(page1.sessions).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await store.list(tenantId, {limit: 2, cursor: page1.nextCursor!});
      expect(page2.sessions).toHaveLength(2);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await store.list(tenantId, {limit: 2, cursor: page2.nextCursor!});
      expect(page3.sessions).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();

      const allIds = [...page1.sessions, ...page2.sessions, ...page3.sessions].map((s) => s.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('throws SessionStoreError on malformed cursor', async () => {
      await expect(
        store.list('tenant-1', {cursor: 'not-base64-at-all!!!'}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('paginates correctly when multiple rows share the same updated_at', async () => {
      // Compound (updated_at, id) cursor must visit every row exactly
      // once even when rows tie on updated_at (batch inserts, sources
      // with millisecond-precision clocks).
      const tenantId = `tenant-tied-${Date.now()}`;
      const sameTs = new Date('2026-05-15T12:00:00.000Z');
      // Use explicit ids so ordering is deterministic across backends
      for (let i = 0; i < 4; i++) {
        await store.save(makeSession({
          id: `tied-${String.fromCharCode(97 + i)}`, // tied-a .. tied-d
          tenantId,
          updatedAt: sameTs,
        }));
      }

      const page1 = await store.list(tenantId, {limit: 2});
      expect(page1.sessions).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await store.list(tenantId, {limit: 2, cursor: page1.nextCursor!});
      expect(page2.sessions).toHaveLength(2);

      const allIds = [...page1.sessions, ...page2.sessions].map((s) => s.id);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds.sort()).toEqual(['tied-a', 'tied-b', 'tied-c', 'tied-d']);
    });
  });

  describe('list — metadata filters', () => {
    it('filters by a metadata string field', async () => {
      const tenantId = `tenant-filter-${Date.now()}`;
      await store.save(makeSession({tenantId, metadata: {status: 'active', appId: 'x'}}));
      await store.save(makeSession({tenantId, metadata: {status: 'archived', appId: 'x'}}));
      await store.save(makeSession({tenantId, metadata: {status: 'active', appId: 'y'}}));

      const {sessions: active} = await store.list(tenantId, {filter: {status: 'active'}});
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.metadata['status'] === 'active')).toBe(true);

      const {sessions: inApp} = await store.list(tenantId, {
        filter: {status: 'active', appId: 'x'},
      });
      expect(inApp).toHaveLength(1);
    });

    it('rejects filter keys with injection characters', async () => {
      await expect(
        store.list('tenant-1', {filter: {"'; DROP TABLE agent_sessions; --": 'x'}}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('rejects filter keys with whitespace / punctuation', async () => {
      await expect(
        store.list('tenant-1', {filter: {'status OR 1=1': 'x'}}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });
  });

  describe('list — date range', () => {
    it('updatedAfter / updatedBefore constrain the result window', async () => {
      const tenantId = `tenant-date-${Date.now()}`;
      await store.save(makeSession({tenantId, updatedAt: new Date('2026-01-01')}));
      await store.save(makeSession({tenantId, updatedAt: new Date('2026-02-15')}));
      await store.save(makeSession({tenantId, updatedAt: new Date('2026-04-01')}));

      const {sessions} = await store.list(tenantId, {
        updatedAfter: new Date('2026-02-01'),
        updatedBefore: new Date('2026-03-01'),
      });
      expect(sessions).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('removes a session and returns true', async () => {
      const session = makeSession();
      await store.save(session);
      expect(await store.delete(session.tenantId, session.id)).toBe(true);
      expect(await store.load(session.tenantId, session.id)).toBeNull();
    });

    it('returns false for a missing session', async () => {
      expect(await store.delete('tenant-1', 'nonexistent')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('removes only sessions older than the cutoff', async () => {
      const tenantId = `tenant-cleanup-${Date.now()}`;
      const old = makeSession({tenantId, updatedAt: new Date('2020-01-01')});
      const recent = makeSession({tenantId, updatedAt: new Date()});
      await store.save(old);
      await store.save(recent);

      const cleaned = await store.cleanup(new Date('2025-01-01'));
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(await store.load(tenantId, old.id)).toBeNull();
      expect(await store.load(tenantId, recent.id)).not.toBeNull();
    });
  });

  describe('hooks', () => {
    it('onAfterSave fires on save', async () => {
      const events: string[] = [];
      const hooked = await makeWithHooks({
        onAfterSave: (s) => { events.push(`save:${s.id}`); },
      });
      try {
        const session = makeSession();
        await hooked.store.save(session);
        expect(events).toEqual([`save:${session.id}`]);
      } finally {
        await hooked.cleanup();
      }
    });

    it('onAfterDelete fires only on actual deletes', async () => {
      const events: string[] = [];
      const hooked = await makeWithHooks({
        onAfterDelete: (id) => { events.push(`del:${id}`); },
      });
      try {
        const session = makeSession();
        await hooked.store.save(session);
        await hooked.store.delete(session.tenantId, 'nonexistent');
        await hooked.store.delete(session.tenantId, session.id);
        expect(events).toEqual([`del:${session.id}`]);
      } finally {
        await hooked.cleanup();
      }
    });

    it('onAfterCleanup fires once with deleted count', async () => {
      const events: Array<{deleted: number}> = [];
      const hooked = await makeWithHooks({
        onAfterCleanup: ({deleted}) => { events.push({deleted}); },
      });
      try {
        await hooked.store.save(
          makeSession({updatedAt: new Date('2020-01-01'), tenantId: 'hook-t'}),
        );
        await hooked.store.save(
          makeSession({updatedAt: new Date('2020-02-01'), tenantId: 'hook-t'}),
        );
        await hooked.store.cleanup(new Date('2025-01-01'));
        expect(events).toHaveLength(1);
        expect(events[0].deleted).toBeGreaterThanOrEqual(2);
      } finally {
        await hooked.cleanup();
      }
    });

    it('hook failure propagates to caller', async () => {
      const hooked = await makeWithHooks({
        onAfterSave: () => { throw new Error('hook failed'); },
      });
      try {
        await expect(hooked.store.save(makeSession())).rejects.toThrow('hook failed');
      } finally {
        await hooked.cleanup();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// PGLite suite (always runs)
// ---------------------------------------------------------------------------

describe('PGLiteSessionStore', () => {
  runSuite(async () => {
    const store = new PGLiteSessionStore({logger});
    await store.initialize();
    return {
      store,
      cleanup: () => store.close(),
      makeWithHooks: async (hooks) => {
        const s = new PGLiteSessionStore({logger, hooks});
        await s.initialize();
        return {store: s, cleanup: () => s.close()};
      },
    };
  });
});

// ---------------------------------------------------------------------------
// Postgres suite (opt-in via TEST_POSTGRES_URL env var)
// ---------------------------------------------------------------------------

const pgUrl = process.env['TEST_POSTGRES_URL'] ?? '';
const pgDescribe = pgUrl ? describe : describe.skip;

pgDescribe('PostgresSessionStore (via TEST_POSTGRES_URL)', () => {
  const TEST_TABLE = 'test_agent_sessions';

  async function dropTable(name: string): Promise<void> {
    const pg = await import('pg');
    const {Pool} = pg.default ?? pg;
    const pool = new Pool({connectionString: pgUrl});
    try {
      await pool.query(`DROP TABLE IF EXISTS ${name} CASCADE`);
    } finally {
      await pool.end();
    }
  }

  runSuite(async () => {
    await dropTable(TEST_TABLE);
    const store = new PostgresSessionStore({
      connectionString: pgUrl,
      tableName: TEST_TABLE,
      logger,
    });
    await store.initialize();
    return {
      store,
      cleanup: () => store.close(),
      makeWithHooks: async (hooks) => {
        const table = `test_h_${Math.random().toString(36).slice(2, 10)}`;
        const s = new PostgresSessionStore({
          connectionString: pgUrl,
          tableName: table,
          logger,
          hooks,
        });
        await s.initialize();
        return {
          store: s,
          cleanup: async () => {
            await s.close();
            await dropTable(table);
          },
        };
      },
    };
  });

  describe('PostgresSessionStore specifics', () => {
    it('accepts an externally-owned pg.Pool and does not close it', async () => {
      const localTable = 'test_ext_pool';
      await dropTable(localTable);
      const pg = await import('pg');
      const {Pool} = pg.default ?? pg;
      const externalPool = new Pool({connectionString: pgUrl});
      try {
        const store = new PostgresSessionStore({
          pool: externalPool,
          tableName: localTable,
          logger,
        });
        await store.initialize();
        await store.save(makeSession());
        await store.close();
        const {rows} = await externalPool.query(`SELECT COUNT(*) AS c FROM ${localTable}`);
        expect(Number(rows[0].c)).toBe(1);
      } finally {
        await externalPool.end();
        await dropTable(localTable);
      }
    });

    it('close() is idempotent and ops after close throw SessionStoreError', async () => {
      const localTable = 'test_close_idemp';
      await dropTable(localTable);
      const store = new PostgresSessionStore({
        connectionString: pgUrl,
        tableName: localTable,
        logger,
      });
      await store.initialize();
      await store.close();
      await store.close();
      await expect(store.save(makeSession())).rejects.toBeInstanceOf(SessionStoreError);
      await expect(store.load('tenant-1', 'x')).rejects.toBeInstanceOf(SessionStoreError);
      await dropTable(localTable);
    });

    it('rejects invalid tableName at construct time', () => {
      expect(
        () => new PostgresSessionStore({
          connectionString: pgUrl,
          tableName: 'bad table; DROP',
          logger,
        }),
      ).toThrow(SessionStoreError);
    });

    it('requires connectionString or pool', () => {
      expect(() => new PostgresSessionStore({logger})).toThrow(SessionStoreError);
    });

    it('concurrent saves to the same id converge', async () => {
      const localTable = 'test_concurrent';
      await dropTable(localTable);
      const store = new PostgresSessionStore({
        connectionString: pgUrl,
        tableName: localTable,
        logger,
      });
      await store.initialize();
      try {
        const id = 'concurrent-id';
        const saves = Array.from({length: 10}, (_, i) =>
          store.save(makeSession({
            id,
            tenantId: 't',
            userId: 'u',
            updatedAt: new Date(2026, 0, 1, 0, 0, i),
            tokenUsage: {inputTokens: i, outputTokens: 0, totalTokens: i},
          })),
        );
        await Promise.all(saves);
        const loaded = await store.load('t', id);
        expect(loaded).not.toBeNull();
        expect(loaded!.tokenUsage.totalTokens).toBeGreaterThanOrEqual(0);
        expect(loaded!.tokenUsage.totalTokens).toBeLessThanOrEqual(9);
      } finally {
        await store.close();
        await dropTable(localTable);
      }
    });
  });
});
