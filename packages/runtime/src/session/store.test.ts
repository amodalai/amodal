/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared session-store tests.
 *
 * Runs the full behaviour matrix (save/load, upsert, pagination,
 * metadata filters, hooks, cleanup) against the PGLite backend by
 * default.
 *
 * A Postgres variant runs only when TEST_POSTGRES_URL is set — same
 * opt-in pattern as `stores/drizzle-store-backend.test.ts`:
 *
 *   TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5433/amodal_test pnpm test
 *
 * Tests that need cross-test isolation use a per-test `scope` string
 * stamped into `metadata.scope` and filter by it. There is no tenant
 * or user concept in the session store.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {createPGLiteSessionStore} from './pglite-session-store.js';
import {createPostgresSessionStore} from './postgres-session-store.js';
import type {SessionStore, SessionStoreHooks} from './store.js';
import type {PersistedSession} from './types.js';
import {SessionStoreError} from '../errors.js';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:session-store'});

/** Fresh per-test scope so list() filters return only this test's rows. */
function newScope(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    version: 1,
    id: `sess-${Math.random().toString(36).slice(2, 10)}`,
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

      const loaded = await store.load(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.version).toBe(1);
      expect(loaded!.messages).toEqual(session.messages);
      expect(loaded!.tokenUsage).toEqual(session.tokenUsage);
      expect(loaded!.metadata).toEqual(session.metadata);
    });

    it('returns null for a missing session', async () => {
      expect(await store.load('nonexistent')).toBeNull();
    });

    it('save updates an existing session (upsert) and refreshes fields', async () => {
      const session = makeSession();
      await store.save(session);

      session.messages = [...session.messages, {role: 'assistant', content: 'Hi'}];
      session.tokenUsage = {inputTokens: 200, outputTokens: 100, totalTokens: 300};
      session.updatedAt = new Date(Date.now() + 1000);
      await store.save(session);

      const loaded = await store.load(session.id);
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
      const loaded = await store.load(session.id);
      expect(loaded!.metadata).toEqual(session.metadata);
    });
  });

  describe('list — ordering', () => {
    it('returns sessions newest first', async () => {
      const scope = newScope('order');
      const older = makeSession({
        metadata: {scope},
        updatedAt: new Date('2026-01-01'),
      });
      const newer = makeSession({
        metadata: {scope},
        updatedAt: new Date('2026-03-01'),
      });
      await store.save(older);
      await store.save(newer);

      const {sessions} = await store.list({filter: {scope}});
      const ids = sessions.map((s) => s.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });
  });

  describe('list — pagination', () => {
    it('returns nextCursor when more rows exist, null when page is final', async () => {
      const scope = newScope('page');
      for (let i = 0; i < 5; i++) {
        await store.save(
          makeSession({metadata: {scope}, updatedAt: new Date(2026, 0, 1 + i)}),
        );
      }

      const page1 = await store.list({limit: 2, filter: {scope}});
      expect(page1.sessions).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await store.list({limit: 2, filter: {scope}, cursor: page1.nextCursor!});
      expect(page2.sessions).toHaveLength(2);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await store.list({limit: 2, filter: {scope}, cursor: page2.nextCursor!});
      expect(page3.sessions).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();

      const allIds = [...page1.sessions, ...page2.sessions, ...page3.sessions].map((s) => s.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('throws SessionStoreError on malformed cursor', async () => {
      await expect(
        store.list({cursor: 'not-base64-at-all!!!'}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('paginates correctly when multiple rows share the same updated_at', async () => {
      // Compound (updated_at, id) cursor must visit every row exactly
      // once even when rows tie on updated_at (batch inserts, sources
      // with millisecond-precision clocks).
      const scope = newScope('tied');
      const sameTs = new Date('2026-05-15T12:00:00.000Z');
      for (let i = 0; i < 4; i++) {
        await store.save(makeSession({
          id: `tied-${String.fromCharCode(97 + i)}-${scope}`,
          metadata: {scope},
          updatedAt: sameTs,
        }));
      }

      const page1 = await store.list({limit: 2, filter: {scope}});
      expect(page1.sessions).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await store.list({limit: 2, filter: {scope}, cursor: page1.nextCursor!});
      expect(page2.sessions).toHaveLength(2);

      const allIds = [...page1.sessions, ...page2.sessions].map((s) => s.id);
      expect(new Set(allIds).size).toBe(4);
    });
  });

  describe('list — metadata filters', () => {
    it('filters by a metadata string field', async () => {
      const scope = newScope('filter');
      await store.save(makeSession({metadata: {scope, status: 'active', appId: 'x'}}));
      await store.save(makeSession({metadata: {scope, status: 'archived', appId: 'x'}}));
      await store.save(makeSession({metadata: {scope, status: 'active', appId: 'y'}}));

      const {sessions: active} = await store.list({filter: {scope, status: 'active'}});
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.metadata['status'] === 'active')).toBe(true);

      const {sessions: inApp} = await store.list({
        filter: {scope, status: 'active', appId: 'x'},
      });
      expect(inApp).toHaveLength(1);
    });

    it('rejects filter keys with injection characters', async () => {
      await expect(
        store.list({filter: {"'; DROP TABLE agent_sessions; --": 'x'}}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('rejects filter keys with whitespace / punctuation', async () => {
      await expect(
        store.list({filter: {'status OR 1=1': 'x'}}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });
  });

  describe('list — date range', () => {
    it('updatedAfter / updatedBefore constrain the result window', async () => {
      const scope = newScope('date');
      await store.save(makeSession({metadata: {scope}, updatedAt: new Date('2026-01-01')}));
      await store.save(makeSession({metadata: {scope}, updatedAt: new Date('2026-02-15')}));
      await store.save(makeSession({metadata: {scope}, updatedAt: new Date('2026-04-01')}));

      const {sessions} = await store.list({
        filter: {scope},
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
      expect(await store.delete(session.id)).toBe(true);
      expect(await store.load(session.id)).toBeNull();
    });

    it('returns false for a missing session', async () => {
      expect(await store.delete('nonexistent')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('removes only sessions older than the cutoff', async () => {
      const scope = newScope('cleanup');
      const old = makeSession({metadata: {scope}, updatedAt: new Date('2020-01-01')});
      const recent = makeSession({metadata: {scope}, updatedAt: new Date()});
      await store.save(old);
      await store.save(recent);

      const cleaned = await store.cleanup(new Date('2025-01-01'));
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(await store.load(old.id)).toBeNull();
      expect(await store.load(recent.id)).not.toBeNull();
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
        await hooked.store.delete('nonexistent');
        await hooked.store.delete(session.id);
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
          makeSession({updatedAt: new Date('2020-01-01')}),
        );
        await hooked.store.save(
          makeSession({updatedAt: new Date('2020-02-01')}),
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

describe('PGLite session store', () => {
  runSuite(async () => {
    const store = await createPGLiteSessionStore({logger});
    return {
      store,
      cleanup: () => store.close(),
      makeWithHooks: async (hooks) => {
        const s = await createPGLiteSessionStore({logger, hooks});
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

pgDescribe('Postgres session store (via TEST_POSTGRES_URL)', () => {
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
    const store = await createPostgresSessionStore({
      connectionString: pgUrl,
      tableName: TEST_TABLE,
      logger,
    });
    return {
      store,
      cleanup: () => store.close(),
      makeWithHooks: async (hooks) => {
        const table = `test_h_${Math.random().toString(36).slice(2, 10)}`;
        const s = await createPostgresSessionStore({
          connectionString: pgUrl,
          tableName: table,
          logger,
          hooks,
        });
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

  describe('Postgres factory specifics', () => {
    it('accepts an externally-owned pg.Pool and does not close it', async () => {
      const localTable = 'test_ext_pool';
      await dropTable(localTable);
      const pg = await import('pg');
      const {Pool} = pg.default ?? pg;
      const externalPool = new Pool({connectionString: pgUrl});
      try {
        const store = await createPostgresSessionStore({
          pool: externalPool,
          tableName: localTable,
          logger,
        });
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
      const store = await createPostgresSessionStore({
        connectionString: pgUrl,
        tableName: localTable,
        logger,
      });
      await store.close();
      await store.close();
      await expect(store.save(makeSession())).rejects.toBeInstanceOf(SessionStoreError);
      await expect(store.load('x')).rejects.toBeInstanceOf(SessionStoreError);
      await dropTable(localTable);
    });

    it('rejects invalid tableName at construct time', async () => {
      await expect(
        createPostgresSessionStore({
          connectionString: pgUrl,
          tableName: 'bad table; DROP',
          logger,
        }),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('requires connectionString or pool', async () => {
      await expect(
        createPostgresSessionStore({logger}),
      ).rejects.toBeInstanceOf(SessionStoreError);
    });

    it('concurrent saves to the same id converge', async () => {
      const localTable = 'test_concurrent';
      await dropTable(localTable);
      const store = await createPostgresSessionStore({
        connectionString: pgUrl,
        tableName: localTable,
        logger,
      });
      try {
        const id = 'concurrent-id';
        const saves = Array.from({length: 10}, (_, i) =>
          store.save(makeSession({
            id,
            updatedAt: new Date(2026, 0, 1, 0, 0, i),
            tokenUsage: {inputTokens: i, outputTokens: 0, totalTokens: i},
          })),
        );
        await Promise.all(saves);
        const loaded = await store.load(id);
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
