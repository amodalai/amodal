/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres factory for the session store.
 *
 * Opens a `pg.Pool` (or reuses one passed in), runs idempotent DDL,
 * and returns a `DrizzleSessionStore` wired to it. Thin factory —
 * all query logic lives in DrizzleSessionStore.
 *
 * For hosted runtime and ISV production deployments. Pair with
 * `createPGLiteSessionStore` for `amodal dev`.
 */

import {drizzle} from 'drizzle-orm/node-postgres';
import {pgTable, text, integer, jsonb, timestamp} from 'drizzle-orm/pg-core';
import type {Pool} from 'pg';

import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';
import {SessionStoreError} from '../errors.js';
import {DrizzleSessionStore} from './drizzle-session-store.js';
import type {AgentSessionsTable} from './drizzle-session-store.js';
import type {SessionStoreHooks} from './store.js';

const BACKEND_NAME = 'postgres';
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_TABLE_NAME = 'agent_sessions';

export interface PostgresSessionStoreOptions {
  /** Postgres connection string. Required if `pool` is not provided. */
  connectionString?: string;
  /** Existing pg.Pool to reuse instead of opening a new one. */
  pool?: Pool;
  /** Pool size when opening a new pool (default 10). Ignored if `pool` is passed. */
  max?: number;
  /** Per-statement timeout in ms (default 30_000). Ignored if `pool` is passed. */
  statementTimeoutMs?: number;
  /**
   * Custom table name (default `agent_sessions`). Lets consumers run
   * this store in a DB that already uses that name for something else.
   */
  tableName?: string;
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
  /** Optional hooks for dual-write / observability. */
  hooks?: SessionStoreHooks;
  /**
   * When true, `close()` will not `pool.end()` — use when the caller
   * owns the pool lifecycle. Defaults to true iff `pool` was passed
   * (caller-owned), false otherwise (store-owned).
   */
  ownsPool?: boolean;
}

// Reject table names that could be used for SQL injection. The name
// is interpolated into DDL so strict validation is mandatory.
const SAFE_TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function validateTableName(name: string): void {
  if (!SAFE_TABLE_NAME_RE.test(name)) {
    throw new SessionStoreError(`Invalid table name: ${JSON.stringify(name)}`, {
      backend: BACKEND_NAME,
      operation: 'construct',
      context: {tableName: name, expected: 'identifier: letters, digits, underscore'},
    });
  }
}

/**
 * Build a Drizzle table binding for a given table name. Columns match
 * the static `agentSessions` schema exactly; only the SQL table name
 * differs. The return is cast to `AgentSessionsTable` (the type alias
 * for `typeof agentSessions`) because the column shape is identical —
 * Drizzle's inferred generic differs only in the `name` literal.
 */
function makeAgentSessionsTable(name: string): AgentSessionsTable {
  const t = pgTable(name, {
    id: text('id').primaryKey(),
    messages: jsonb('messages').notNull().$type<unknown[]>(),
    tokenUsage: jsonb('token_usage').notNull().$type<{
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>(),
    metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic-name table has identical column shape as the static `agentSessions`; only the `name` generic parameter differs
  return t as unknown as AgentSessionsTable;
}

function buildDdl(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      messages JSONB NOT NULL,
      token_usage JSONB NOT NULL,
      metadata JSONB DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_${tableName}_updated
      ON ${tableName} (updated_at DESC);
  `;
}

/**
 * Create and initialize a Postgres-backed session store.
 *
 * Accepts either a connection string (shorthand) or full options
 * object. Validates `tableName` at construct time, opens (or adopts)
 * a `pg.Pool`, runs idempotent DDL, and returns a DrizzleSessionStore.
 * The returned store's `close()` will `pool.end()` unless
 * `ownsPool: false` (set automatically when a pool is passed in).
 */
export async function createPostgresSessionStore(
  optsOrUrl: PostgresSessionStoreOptions | string,
): Promise<DrizzleSessionStore> {
  const opts: PostgresSessionStoreOptions =
    typeof optsOrUrl === 'string' ? {connectionString: optsOrUrl} : optsOrUrl;

  if (!opts.connectionString && !opts.pool) {
    throw new SessionStoreError(
      'createPostgresSessionStore requires either connectionString or pool',
      {backend: BACKEND_NAME, operation: 'construct'},
    );
  }

  const logger = opts.logger ?? defaultLogger;
  const tableName = opts.tableName ?? DEFAULT_TABLE_NAME;
  validateTableName(tableName);
  const table = makeAgentSessionsTable(tableName);
  const ownsPool = opts.ownsPool ?? !opts.pool;

  let pool: Pool;
  if (opts.pool) {
    pool = opts.pool;
  } else {
    // Dynamic import so `pg` stays an optional peer at the package
    // level — PGLite users don't need it installed.
    const pg = await import('pg');
    const {Pool: PgPool} = pg.default ?? pg;
    pool = new PgPool({
      connectionString: opts.connectionString,
      max: opts.max ?? DEFAULT_POOL_MAX,
      statement_timeout: opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    });
  }

  try {
    await pool.query(buildDdl(tableName));
  } catch (cause) {
    throw new SessionStoreError('Failed to create session table', {
      backend: BACKEND_NAME,
      operation: 'initialize',
      cause,
      context: {tableName},
    });
  }

  const db = drizzle(pool);

  logger.info('session_store_initialized', {
    backend: BACKEND_NAME,
    tableName,
    poolMax: opts.max ?? DEFAULT_POOL_MAX,
    statementTimeoutMs: opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    ownsPool,
  });

  return new DrizzleSessionStore({
    db,
    table,
    backendName: BACKEND_NAME,
    logger,
    hooks: opts.hooks,
    onClose: async () => {
      if (ownsPool) await pool.end();
    },
  });
}
