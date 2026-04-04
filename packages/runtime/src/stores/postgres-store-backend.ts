/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres-backed store backend for the hosted runtime.
 *
 * Thin factory over DrizzleStoreBackend using drizzle-orm/node-postgres.
 * Shares all query logic and DDL with the PGLite backend via the
 * `stores/schema.ts` Drizzle schema.
 *
 * Tables are created in the connection's default schema (typically
 * `public`). Callers who need isolation should use a dedicated database
 * per tenant/environment rather than schema namespacing — that avoids
 * the search_path / connection-pool interaction hazards that
 * schema-scoping introduces.
 */

import {drizzle} from 'drizzle-orm/node-postgres';
import type {LoadedStore} from '@amodalai/core';

import {DrizzleStoreBackend} from './drizzle-store-backend.js';
import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';

// Default per-statement timeout. Protects against hung queries blocking
// the write queue — satisfies the CLAUDE.md "External calls (fetch,
// database, MCP) without AbortSignal.timeout()" rule at the pool level.
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

const CREATE_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS store_documents (
    app_id TEXT NOT NULL,
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    meta JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_id, store, key)
  );

  CREATE INDEX IF NOT EXISTS idx_store_documents_store
    ON store_documents (app_id, store);

  CREATE INDEX IF NOT EXISTS idx_store_documents_expires
    ON store_documents (expires_at)
    WHERE expires_at IS NOT NULL;

  CREATE TABLE IF NOT EXISTS store_document_versions (
    id SERIAL PRIMARY KEY,
    app_id TEXT NOT NULL,
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    meta JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_store_versions_lookup
    ON store_document_versions (app_id, store, key, version DESC);
`;

export interface PostgresStoreBackendOptions {
  /** Postgres connection string, e.g. `postgres://user:pass@host:5432/db`. */
  connectionString: string;
  /** Pool size (default 10). */
  max?: number;
  /** Per-statement timeout in ms (default 30_000). */
  statementTimeoutMs?: number;
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
}

/**
 * Create a Postgres store backend.
 *
 * Opens a connection pool with `statement_timeout` set so hung queries
 * can't block the write queue, runs idempotent DDL, and returns a
 * DrizzleStoreBackend wired to the pool. The returned backend's
 * `close()` will drain and end the pool.
 *
 * Accepts either a connection string (shorthand) or a full options
 * object — matches `createPGLiteStoreBackend`'s call-site ergonomics.
 */
export async function createPostgresStoreBackend(
  stores: LoadedStore[],
  optsOrUrl: PostgresStoreBackendOptions | string,
): Promise<DrizzleStoreBackend> {
  const opts: PostgresStoreBackendOptions =
    typeof optsOrUrl === 'string' ? {connectionString: optsOrUrl} : optsOrUrl;

  const logger = opts.logger ?? defaultLogger;

  // Dynamic import so `pg` stays an optional peer at the package level —
  // PGLite users don't need it installed.
  const pg = await import('pg');
  const {Pool} = pg.default ?? pg;

  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    statement_timeout: opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  });

  await pool.query(CREATE_TABLES_DDL);

  const db = drizzle(pool);

  logger.info('postgres_store_backend_ready', {
    max: opts.max ?? 10,
    statementTimeoutMs: opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    storeCount: stores.length,
  });

  return new DrizzleStoreBackend({
    db,
    stores,
    logger,
    onClose: async () => {
      await pool.end();
    },
  });
}
