/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres-backed session store for the hosted runtime and ISV
 * production deployments.
 *
 * Shares the Drizzle `agentSessions` schema and query helpers with
 * `PGLiteSessionStore` — the difference is the driver (`node-postgres`
 * pool vs. in-process WASM) and the DDL execution path (raw `pool.query`
 * vs. PGLite's `exec`).
 *
 * Design decisions documented in `cloud/docs/session-store-design.md`.
 */

import {eq, lt, desc} from 'drizzle-orm';
import {pgTable, text, integer, jsonb, timestamp} from 'drizzle-orm/pg-core';
import {drizzle} from 'drizzle-orm/node-postgres';
import type {Pool} from 'pg';

import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';
import {SessionStoreError} from '../errors.js';
import type {PersistedSession} from './types.js';
import {
  buildListConditions,
  encodeCursor,
  rowToPersistedSession,
  sessionToRow,
} from './store.js';
import type {
  SessionListOptions,
  SessionListResult,
  SessionStore,
  SessionStoreHooks,
} from './store.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_NAME = 'postgres-session-store';
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_TABLE_NAME = 'agent_sessions';

/**
 * Options for `createPostgresSessionStore` / `PostgresSessionStore`.
 *
 * Either `connectionString` or `pool` must be set. Passing `pool` lets
 * consumers share an existing `pg.Pool` with other DB-using code (e.g.
 * the hosted runtime sharing with its document store pool).
 */
export interface PostgresSessionStoreOptions {
  /** Postgres connection string. Required if `pool` is not provided. */
  connectionString?: string;
  /** Existing pg.Pool to reuse instead of opening a new one. */
  pool?: Pool;
  /** Pool size when opening a new pool (default 10). Ignored if `pool` is passed. */
  max?: number;
  /** Per-statement timeout in ms (default 30_000). Ignored if `pool` is passed. */
  statementTimeoutMs?: number;
  /** Custom table name (default `agent_sessions`). */
  tableName?: string;
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
  /** Optional hooks for dual-write/observability. */
  hooks?: SessionStoreHooks;
  /**
   * When true, the store will not `pool.end()` on close — useful when
   * the caller owns the pool lifecycle. Defaults to true iff `pool` was
   * passed in (caller-owned), false otherwise (store-owned).
   */
  ownsPool?: boolean;
}

// ---------------------------------------------------------------------------
// Dynamic schema builder
// ---------------------------------------------------------------------------

/**
 * Build a Drizzle table binding for a given table name. Columns match
 * `stores/schema.ts` `agentSessions` exactly; only the SQL table name
 * differs. Lets consumers run this store in a DB that already uses
 * `agent_sessions` for something else.
 */
function makeAgentSessionsTable(name: string) {
  return pgTable(name, {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    messages: jsonb('messages').notNull().$type<unknown[]>(),
    tokenUsage: jsonb('token_usage').notNull().$type<{
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>(),
    metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  });
}

/**
 * Reject table names that could be used for SQL injection. Only simple
 * identifiers allowed; the name is interpolated into DDL.
 */
const SAFE_TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function validateTableName(name: string): void {
  if (!SAFE_TABLE_NAME_RE.test(name)) {
    throw new SessionStoreError(
      `Invalid table name: ${JSON.stringify(name)}`,
      {
        backend: BACKEND_NAME,
        operation: 'initialize',
        context: {tableName: name, expected: 'identifier: letters, digits, underscore'},
      },
    );
  }
}

function buildDdl(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
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

    CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant
      ON ${tableName} (tenant_id, updated_at DESC);
  `;
}

// ---------------------------------------------------------------------------
// PostgresSessionStore
// ---------------------------------------------------------------------------

export class PostgresSessionStore implements SessionStore {
  private readonly opts: PostgresSessionStoreOptions;
  private readonly logger: Logger;
  private readonly hooks: SessionStoreHooks;
  private readonly tableName: string;
  private readonly table: ReturnType<typeof makeAgentSessionsTable>;
  private readonly ownsPool: boolean;

  private pool: Pool | null = null;
  private db: ReturnType<typeof drizzle> | null = null;
  private closed = false;

  constructor(opts: PostgresSessionStoreOptions) {
    if (!opts.connectionString && !opts.pool) {
      throw new SessionStoreError(
        'PostgresSessionStore requires either connectionString or pool',
        {backend: BACKEND_NAME, operation: 'construct'},
      );
    }
    this.opts = opts;
    this.logger = opts.logger ?? defaultLogger;
    this.hooks = opts.hooks ?? {};
    this.tableName = opts.tableName ?? DEFAULT_TABLE_NAME;
    validateTableName(this.tableName);
    this.table = makeAgentSessionsTable(this.tableName);
    // Caller-owned pool by default when pool is passed; otherwise
    // store opened it, so store owns close.
    this.ownsPool = opts.ownsPool ?? !opts.pool;
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.closed) {
      throw new SessionStoreError('PostgresSessionStore is closed', {
        backend: BACKEND_NAME,
        operation: 'initialize',
      });
    }

    if (this.opts.pool) {
      this.pool = this.opts.pool;
    } else {
      // Dynamic import so `pg` stays an optional peer at the package
      // level — PGLite users don't need it installed.
      const pg = await import('pg');
      const {Pool: PgPool} = pg.default ?? pg;
      this.pool = new PgPool({
        connectionString: this.opts.connectionString,
        max: this.opts.max ?? DEFAULT_POOL_MAX,
        statement_timeout: this.opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      });
    }

    try {
      await this.pool.query(buildDdl(this.tableName));
    } catch (cause) {
      throw new SessionStoreError('Failed to create session table', {
        backend: BACKEND_NAME,
        operation: 'initialize',
        cause,
        context: {tableName: this.tableName},
      });
    }

    this.db = drizzle(this.pool);

    this.logger.info('session_store_initialized', {
      backend: 'postgres',
      tableName: this.tableName,
      poolMax: this.opts.max ?? DEFAULT_POOL_MAX,
      statementTimeoutMs: this.opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      ownsPool: this.ownsPool,
    });
  }

  async save(session: PersistedSession): Promise<void> {
    this.ensureDb('save');
    const values = sessionToRow(session);

    try {
      await this.db!
        .insert(this.table)
        .values(values)
        .onConflictDoUpdate({
          target: this.table.id,
          set: {
            messages: values.messages,
            tokenUsage: values.tokenUsage,
            metadata: values.metadata,
            updatedAt: values.updatedAt,
          },
        });
    } catch (cause) {
      throw new SessionStoreError('Failed to save session', {
        backend: BACKEND_NAME,
        operation: 'save',
        cause,
        context: {sessionId: session.id},
      });
    }

    if (this.hooks.onAfterSave) await this.hooks.onAfterSave(session);
  }

  async load(sessionId: string): Promise<PersistedSession | null> {
    this.ensureDb('load');

    try {
      const rows = await this.db!
        .select()
        .from(this.table)
        .where(eq(this.table.id, sessionId))
        .limit(1);

      if (rows.length === 0) return null;
      return rowToPersistedSession(rows[0]);
    } catch (cause) {
      throw new SessionStoreError('Failed to load session', {
        backend: BACKEND_NAME,
        operation: 'load',
        cause,
        context: {sessionId},
      });
    }
  }

  async list(tenantId: string, opts?: SessionListOptions): Promise<SessionListResult> {
    this.ensureDb('list');

    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    // buildListConditions uses the passed-in table's column names —
    // works with our dynamic table because columns are identical.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic table has identical column shape as the `agentSessions` schema; only the SQL table name differs
    const where = buildListConditions(BACKEND_NAME, tenantId, opts, this.table as unknown as Parameters<typeof buildListConditions>[3]);

    try {
      const rows = await this.db!
        .select()
        .from(this.table)
        .where(where)
        .orderBy(desc(this.table.updatedAt), desc(this.table.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const sessions = page.map(rowToPersistedSession);
      const nextCursor = hasMore
        ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id)
        : null;

      return {sessions, nextCursor};
    } catch (cause) {
      // Re-raise SessionStoreError (filter/cursor validation) as-is
      if (cause instanceof SessionStoreError) throw cause;
      throw new SessionStoreError('Failed to list sessions', {
        backend: BACKEND_NAME,
        operation: 'list',
        cause,
        context: {tenantId},
      });
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    this.ensureDb('delete');

    let result: Array<{id: string}>;
    try {
      result = await this.db!
        .delete(this.table)
        .where(eq(this.table.id, sessionId))
        .returning({id: this.table.id});
    } catch (cause) {
      throw new SessionStoreError('Failed to delete session', {
        backend: BACKEND_NAME,
        operation: 'delete',
        cause,
        context: {sessionId},
      });
    }

    const deleted = result.length > 0;
    if (deleted && this.hooks.onAfterDelete) {
      await this.hooks.onAfterDelete(sessionId);
    }
    return deleted;
  }

  async cleanup(before: Date): Promise<number> {
    this.ensureDb('cleanup');

    let result: Array<{id: string}>;
    try {
      result = await this.db!
        .delete(this.table)
        .where(lt(this.table.updatedAt, before))
        .returning({id: this.table.id});
    } catch (cause) {
      throw new SessionStoreError('Failed to cleanup sessions', {
        backend: BACKEND_NAME,
        operation: 'cleanup',
        cause,
        context: {before: before.toISOString()},
      });
    }

    if (result.length > 0) {
      this.logger.info('session_store_cleanup', {
        backend: 'postgres',
        deleted: result.length,
      });
    }

    if (this.hooks.onAfterCleanup) {
      await this.hooks.onAfterCleanup({deleted: result.length, before});
    }
    return result.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db = null;
    const pool = this.pool;
    this.pool = null;
    if (pool && this.ownsPool) {
      try {
        await pool.end();
      } catch (cause) {
        throw new SessionStoreError('Failed to end Postgres pool', {
          backend: BACKEND_NAME,
          operation: 'close',
          cause,
        });
      }
    }
  }

  private ensureDb(operation: string): void {
    if (this.closed) {
      throw new SessionStoreError('PostgresSessionStore is closed', {
        backend: BACKEND_NAME,
        operation,
      });
    }
    if (!this.db) {
      throw new SessionStoreError(
        'PostgresSessionStore not initialized — call initialize() first',
        {backend: BACKEND_NAME, operation},
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and initialize a `PostgresSessionStore`. Accepts a connection
 * string (shorthand) or full options object — matches
 * `createPostgresStoreBackend`'s call-site ergonomics.
 */
export async function createPostgresSessionStore(
  optsOrUrl: PostgresSessionStoreOptions | string,
): Promise<PostgresSessionStore> {
  const opts: PostgresSessionStoreOptions =
    typeof optsOrUrl === 'string' ? {connectionString: optsOrUrl} : optsOrUrl;
  const store = new PostgresSessionStore(opts);
  await store.initialize();
  return store;
}
