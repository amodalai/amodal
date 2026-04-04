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
 */

import {drizzle} from 'drizzle-orm/node-postgres';
import type {LoadedStore} from '@amodalai/core';

import {DrizzleStoreBackend} from './drizzle-store-backend.js';
import {log} from '../logger.js';

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
  /** Optional schema name. If set, tables are created under this schema. */
  schema?: string;
  /** Pool size (default 10). */
  max?: number;
}

/**
 * Create a Postgres store backend.
 *
 * Opens a connection pool, runs DDL (idempotent), and returns a
 * DrizzleStoreBackend wired to the pool. The returned backend's
 * `close()` will drain and end the pool.
 */
export async function createPostgresStoreBackend(
  stores: LoadedStore[],
  opts: PostgresStoreBackendOptions,
): Promise<DrizzleStoreBackend> {
  // Dynamic import so `pg` stays an optional peer at the package level —
  // PGLite users don't need it installed.
  const pg = await import('pg');
  // node-postgres ships as both CJS and ESM; the default export holds Pool.
  const {Pool} = pg.default ?? pg;

  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
  });

  if (opts.schema) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${opts.schema.replace(/"/g, '')}"`);
    await pool.query(`SET search_path TO "${opts.schema.replace(/"/g, '')}"`);
  }
  await pool.query(CREATE_TABLES_DDL);

  const db = drizzle(pool);

  return new DrizzleStoreBackend({
    db,
    stores,
    logger: log,
    onClose: async () => {
      await pool.end();
    },
  });
}
