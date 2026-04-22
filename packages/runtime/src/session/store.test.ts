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
import {createPostgresSessionStore} from './postgres-session-store.js';
import {sessionToRow, rowToPersistedSession} from './store.js';
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
    imageData: {},
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
// Postgres suite (requires DATABASE_URL)
// ---------------------------------------------------------------------------

const skip = !process.env['DATABASE_URL'];

describe.skipIf(skip)('Postgres session store', () => {
  runSuite(async () => {
    const store = await createPostgresSessionStore({logger});
    return {
      store,
      cleanup: () => store.close(),
      makeWithHooks: async (hooks) => {
        const s = await createPostgresSessionStore({logger, hooks});
        return {store: s, cleanup: () => s.close()};
      },
    };
  });
});

// No longer need the TEST_POSTGRES_URL variant — all tests use DATABASE_URL above.

// ---------------------------------------------------------------------------
// extractImages / rehydrateImages round-trip tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal row object matching `agentSessions.$inferSelect`.
 */
function makeRow(overrides: Partial<{
  id: string;
  scopeId: string;
  messages: unknown[];
  tokenUsage: {inputTokens: number; outputTokens: number; totalTokens: number};
  metadata: Record<string, unknown>;
  imageData: Record<string, {mimeType: string; data: string}> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'test-session',
    scopeId: overrides.scopeId ?? '',
    messages: overrides.messages ?? [],
    tokenUsage: overrides.tokenUsage ?? {inputTokens: 0, outputTokens: 0, totalTokens: 0},
    metadata: overrides.metadata ?? {},
    imageData: overrides.imageData ?? {},
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

describe('extractImages / rehydrateImages round-trip', () => {
  it('extracts image parts into imageData and inserts placeholders', () => {
    const session: PersistedSession = {
      version: 1,
      id: 'sess-img-1',
      messages: [
        {
          role: 'user',
          content: [
            {type: 'image', image: 'base64data', mediaType: 'image/png'},
            {type: 'text', text: 'What is this?'},
          ],
        },
      ],
      tokenUsage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
      metadata: {},
      imageData: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const row = sessionToRow(session);

    // Messages should contain a placeholder instead of image data
    const userMsg = row.messages[0] as {role: string; content: Array<{type: string; text?: string}>};
    expect(userMsg.content).toHaveLength(2);
    const imagePart = userMsg.content.find((p) => p.type === 'text' && p.text?.startsWith('__amodal_imgref:'));
    expect(imagePart).toBeDefined();

    // imageData should have the extracted image
    const refIds = Object.keys(row.imageData);
    expect(refIds).toHaveLength(1);
    expect(row.imageData[refIds[0]]).toEqual({mimeType: 'image/png', data: 'base64data'});
  });

  it('rehydrates placeholders back to image parts on load', () => {
    const session: PersistedSession = {
      version: 1,
      id: 'sess-img-2',
      messages: [
        {
          role: 'user',
          content: [
            {type: 'image', image: 'mybase64', mediaType: 'image/jpeg'},
            {type: 'text', text: 'Describe this'},
          ],
        },
      ],
      tokenUsage: {inputTokens: 10, outputTokens: 20, totalTokens: 30},
      metadata: {},
      imageData: {},
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-02'),
    };

    const row = sessionToRow(session);

    const restored = rowToPersistedSession('test', makeRow({
      id: row.id,
      messages: row.messages,
      tokenUsage: row.tokenUsage,
      metadata: row.metadata,
      imageData: row.imageData,
      version: 1,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));

    const userMsg = restored.messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    const parts = userMsg.content as Array<{type: string; image?: string; mediaType?: string; text?: string}>;
    const imgPart = parts.find((p) => p.type === 'image');
    expect(imgPart).toBeDefined();
    expect(imgPart!.image).toBe('mybase64');
    expect(imgPart!.mediaType).toBe('image/jpeg');

    const textPart = parts.find((p) => p.type === 'text');
    expect(textPart).toBeDefined();
    expect(textPart!.text).toBe('Describe this');
  });

  it('passes messages through unchanged when imageData is empty', () => {
    const messages = [
      {role: 'user' as const, content: 'Hello'},
      {role: 'assistant' as const, content: 'Hi there!'},
    ];

    const restored = rowToPersistedSession('test', makeRow({
      messages: messages as unknown[],
      imageData: {},
    }));

    expect(restored.messages).toEqual(messages);
  });

  it('leaves placeholder as-is when ref is missing from imageData', () => {
    const placeholder = '__amodal_imgref:deadbeef1234__';
    const messages = [
      {
        role: 'user' as const,
        content: [
          {type: 'text' as const, text: placeholder},
          {type: 'text' as const, text: 'Some text'},
        ],
      },
    ];

    // Use a non-empty imageData that doesn't contain the referenced ID
    const restored = rowToPersistedSession('test', makeRow({
      messages: messages as unknown[],
      imageData: {'other-ref': {mimeType: 'image/png', data: 'abc'}},
    }));

    const userMsg = restored.messages[0];
    const parts = userMsg.content as Array<{type: string; text?: string}>;
    const refPart = parts.find((p) => p.text === placeholder);
    expect(refPart).toBeDefined();
    expect(refPart!.type).toBe('text');
  });
});
