/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session persistence layer.
 *
 * Defines the `SessionStore` interface and a PGLite implementation
 * backed by Drizzle ORM. The Drizzle schema is in `stores/schema.ts`,
 * shared with the store document tables.
 *
 * The Postgres implementation lives in `./postgres-store.ts` and reuses
 * the shared query helpers defined below via `runSessionQueries()`.
 */

import {and, eq, lt, gte, lte, desc, sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/pglite';
import {agentSessions} from '../stores/schema.js';
import type {PersistedSession, SessionMetadata} from './types.js';
import type {TokenUsage} from '../providers/types.js';
import type {ModelMessage} from 'ai';
import type {Logger} from '../logger.js';
import {ConfigError, SessionStoreError} from '../errors.js';

// ---------------------------------------------------------------------------
// List options, hooks, and cursor type
// ---------------------------------------------------------------------------

/**
 * Options for `SessionStore.list()`.
 *
 * Cursor-based pagination over `updated_at` (newest first). The cursor
 * encodes the updatedAt/id pair of the last row returned — pass it back
 * unchanged to fetch the next page.
 *
 * Filters match against metadata JSONB paths using equality. Only
 * `snake_case` / simple identifier keys are accepted — see
 * `validateFilterKey` for the exact rules. Passing an untrusted key
 * throws `SessionStoreError`.
 *
 * `updatedAfter` / `updatedBefore` filter by the `updated_at` column
 * (inclusive). Useful for "sessions touched this week" queries.
 */
export interface SessionListOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly updatedAfter?: Date;
  readonly updatedBefore?: Date;
}

/**
 * Result of `SessionStore.list()` — sessions plus an opaque cursor
 * for the next page. `nextCursor` is `null` when there are no more rows.
 */
export interface SessionListResult {
  readonly sessions: PersistedSession[];
  readonly nextCursor: string | null;
}

/**
 * Optional callbacks fired after mutations. Each hook is awaited, so
 * a failing hook propagates to the caller. Keep hooks fast — they sit
 * on the write path.
 *
 * Intended use: dual-write to a consumer's own table (hosted-runtime
 * adoption path), emit observability events, invalidate caches.
 */
export interface SessionStoreHooks {
  onAfterSave?: (session: PersistedSession) => Promise<void> | void;
  onAfterDelete?: (sessionId: string) => Promise<void> | void;
  onAfterCleanup?: (opts: {deleted: number; before: Date}) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// SessionStore interface
// ---------------------------------------------------------------------------

/**
 * Interface for session persistence backends.
 *
 * Implementations: PGLiteSessionStore (local dev), PostgresSessionStore
 * (hosted runtime / ISV production). Both share the `agentSessions`
 * Drizzle schema and the query helpers in this module.
 */
export interface SessionStore {
  /** Initialize the backing store (create tables, run migrations). */
  initialize(): Promise<void>;

  /** Save or update a session. */
  save(session: PersistedSession): Promise<void>;

  /** Load a session by ID. Returns null if not found. */
  load(sessionId: string): Promise<PersistedSession | null>;

  /**
   * List sessions for a tenant, newest first.
   *
   * Returns sessions + a pagination cursor. Existing callers that pass
   * only `{limit}` still work — they just ignore `nextCursor`.
   */
  list(tenantId: string, opts?: SessionListOptions): Promise<SessionListResult>;

  /** Delete a session by ID. Returns true if deleted. */
  delete(sessionId: string): Promise<boolean>;

  /** Delete sessions not updated since `before`. Returns count deleted. */
  cleanup(before: Date): Promise<number>;

  /** Close the backing store. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers — used by both PGLite and Postgres implementations
// ---------------------------------------------------------------------------

/**
 * Reject filter keys that could be used for SQL injection. We only
 * allow simple identifiers: letters, digits, underscores. The keys
 * become part of a JSONB path (`metadata->>'key'`) so they must be
 * safe to interpolate.
 */
const SAFE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateFilterKey(backend: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new SessionStoreError(
      `Invalid filter field name: ${JSON.stringify(key)}`,
      {
        backend,
        operation: 'list',
        context: {key, expected: 'identifier: letters, digits, underscore only'},
      },
    );
  }
}

/** Encode a cursor as opaque base64 of "updatedAt.ms|id". */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.getTime()}|${id}`, 'utf8').toString('base64url');
}

/** Decode a cursor; throws SessionStoreError on malformed input. */
export function decodeCursor(
  backend: string,
  cursor: string,
): {updatedAt: Date; id: string} {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep < 0) throw new Error('missing separator');
    const ms = Number(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(ms) || !id) throw new Error('bad parts');
    return {updatedAt: new Date(ms), id};
  } catch (cause) {
    throw new SessionStoreError('Invalid pagination cursor', {
      backend,
      operation: 'list',
      cause,
    });
  }
}

/**
 * Map a `PersistedSession` to its row shape for insert/update. Separate
 * function so both backends do the exact same type conversion.
 */
export function sessionToRow(session: PersistedSession): {
  id: string;
  tenantId: string;
  userId: string;
  messages: unknown[];
  tokenUsage: {inputTokens: number; outputTokens: number; totalTokens: number};
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: session.id,
    tenantId: session.tenantId,
    userId: session.userId,
    messages: session.messages as unknown[],
    tokenUsage: session.tokenUsage as {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    metadata: session.metadata as Record<string, unknown>,
    version: session.version,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Inverse of `sessionToRow`. */
export function rowToPersistedSession(row: typeof agentSessions.$inferSelect): PersistedSession {
  return {
    version: 1,
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSONB boundary: we wrote these values
    messages: row.messages as ModelMessage[],

    tokenUsage: row.tokenUsage as TokenUsage,

    metadata: (row.metadata ?? {}) as SessionMetadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build the where-clause fragments for `list()`. Backends pass in their
 * own table binding since drizzle's Postgres vs. PGLite adapters return
 * slightly different table types, but the SQL is identical.
 */
export function buildListConditions(
  backend: string,
  tenantId: string,
  opts: SessionListOptions | undefined,
  // Using loose typing here: buildListConditions accepts any agentSessions-shaped
  // table so both PGLite and Postgres adapters share it.
  table: typeof agentSessions,
): ReturnType<typeof and> {
  const conditions = [eq(table.tenantId, tenantId)];

  if (opts?.cursor) {
    const {updatedAt: cursorTs} = decodeCursor(backend, opts.cursor);
    // Strictly-older-than cursor keeps pagination stable as long as no
    // two rows share updated_at. On ties we'd need a compound cursor on
    // (updated_at, id); `lt` alone is fine for the conservative case
    // and matches how we encode.
    conditions.push(lt(table.updatedAt, cursorTs));
  }

  if (opts?.updatedAfter) conditions.push(gte(table.updatedAt, opts.updatedAfter));
  if (opts?.updatedBefore) conditions.push(lte(table.updatedAt, opts.updatedBefore));

  if (opts?.filter) {
    for (const [key, val] of Object.entries(opts.filter)) {
      validateFilterKey(backend, key);
      // metadata->>'key' = value (string equality). JSONB `->>` returns
      // text; we coerce the user-supplied value to its JSON string form
      // via parameter binding, so non-string values like numbers/bools
      // compare correctly: metadata->>'n' = '42'.
      const textVal = typeof val === 'string' ? val : JSON.stringify(val);
      conditions.push(
        sql`${table.metadata}->>${sql.raw(`'${key}'`)} = ${textVal}`,
      );
    }
  }

  return and(...conditions);
}

// ---------------------------------------------------------------------------
// PGLite implementation
// ---------------------------------------------------------------------------

const BACKEND_NAME_PGLITE = 'pglite-session-store';
const DEFAULT_LIST_LIMIT = 50;

/**
 * PGLite-backed session store using Drizzle ORM.
 *
 * Runs an in-process WASM Postgres instance. Data is persisted to a
 * configurable directory (default: in-memory).
 */
export class PGLiteSessionStore implements SessionStore {
  private db: ReturnType<typeof drizzle> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGLite instance type is not exported cleanly
  private pglite: any = null;
  private readonly dataDir: string | undefined;
  private readonly logger: Logger;
  private readonly hooks: SessionStoreHooks;

  constructor(opts: {dataDir?: string; logger: Logger; hooks?: SessionStoreHooks}) {
    this.dataDir = opts.dataDir;
    this.logger = opts.logger;
    this.hooks = opts.hooks ?? {};
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    if (this.dataDir) {
      const {mkdirSync} = await import('node:fs');
      mkdirSync(this.dataDir, {recursive: true});
    }

    const {PGlite} = await import('@electric-sql/pglite');
    this.pglite = new PGlite(this.dataDir ?? undefined);
    this.db = drizzle(this.pglite);

    // Create table via raw SQL — Drizzle schema defines the shape,
    // but we use raw DDL for initialization (no drizzle-kit in runtime).
    await this.pglite.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages JSONB NOT NULL,
        token_usage JSONB NOT NULL,
        metadata JSONB DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant
        ON agent_sessions (tenant_id, updated_at DESC);
    `);

    this.logger.info('session_store_initialized', {
      backend: 'pglite',
      dataDir: this.dataDir ?? 'in-memory',
    });
  }

  async save(session: PersistedSession): Promise<void> {
    this.ensureDb();
    const values = sessionToRow(session);

    await this.db!
      .insert(agentSessions)
      .values(values)
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          messages: values.messages,
          tokenUsage: values.tokenUsage,
          metadata: values.metadata,
          updatedAt: values.updatedAt,
        },
      });

    if (this.hooks.onAfterSave) await this.hooks.onAfterSave(session);
  }

  async load(sessionId: string): Promise<PersistedSession | null> {
    this.ensureDb();

    const rows = await this.db!
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToPersistedSession(rows[0]);
  }

  async list(tenantId: string, opts?: SessionListOptions): Promise<SessionListResult> {
    this.ensureDb();

    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const where = buildListConditions(BACKEND_NAME_PGLITE, tenantId, opts, agentSessions);

    const rows = await this.db!
      .select()
      .from(agentSessions)
      .where(where)
      .orderBy(desc(agentSessions.updatedAt))
      .limit(limit + 1); // +1 to detect "is there a next page"

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const sessions = page.map(rowToPersistedSession);

    const nextCursor = hasMore
      ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id)
      : null;

    return {sessions, nextCursor};
  }

  async delete(sessionId: string): Promise<boolean> {
    this.ensureDb();

    const result = await this.db!
      .delete(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .returning({id: agentSessions.id});

    const deleted = result.length > 0;
    if (deleted && this.hooks.onAfterDelete) {
      await this.hooks.onAfterDelete(sessionId);
    }
    return deleted;
  }

  async cleanup(before: Date): Promise<number> {
    this.ensureDb();

    const result = await this.db!
      .delete(agentSessions)
      .where(lt(agentSessions.updatedAt, before))
      .returning({id: agentSessions.id});

    if (result.length > 0) {
      this.logger.info('session_store_cleanup', {deleted: result.length});
    }

    if (this.hooks.onAfterCleanup) {
      await this.hooks.onAfterCleanup({deleted: result.length, before});
    }
    return result.length;
  }

  async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
      this.db = null;
    }
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new ConfigError('PGLiteSessionStore not initialized — call initialize() first', {
        key: 'sessionStore',
        suggestion: 'Call initialize() before using the session store',
      });
    }
  }
}

