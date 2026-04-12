/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres-backed store backend for the hosted runtime.
 *
 * Thin factory over DrizzleStoreBackend using the shared `getDb()`
 * singleton from `@amodalai/db`. Schema migration is handled by
 * `ensureSchema()` at server startup — this factory only wires up
 * the DrizzleStoreBackend to the shared connection.
 */

import {getDb} from '@amodalai/db';
import type {LoadedStore} from '@amodalai/core';

import {DrizzleStoreBackend} from './drizzle-store-backend.js';
import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';

export interface PostgresStoreBackendOptions {
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
}

/**
 * Create a Postgres store backend using the shared `getDb()` connection.
 *
 * `ensureSchema()` must have been called before this function — the
 * factory does NOT run DDL. The returned backend's `close()` is a no-op
 * because the connection pool is owned by the `@amodalai/db` singleton.
 */
export async function createPostgresStoreBackend(
  stores: LoadedStore[],
  optsOrUrl?: PostgresStoreBackendOptions | string,
): Promise<DrizzleStoreBackend> {
  // Accept a string for backwards compat (ignored — getDb reads DATABASE_URL)
  const opts: PostgresStoreBackendOptions =
    typeof optsOrUrl === 'string' ? {} : (optsOrUrl ?? {});

  const logger = opts.logger ?? defaultLogger;
  const db = getDb();

  logger.info('postgres_store_backend_ready', {
    storeCount: stores.length,
  });

  return new DrizzleStoreBackend({
    db,
    stores,
    logger,
    onClose: async () => {
      // Connection pool is owned by the @amodalai/db singleton —
      // closing happens via closeDb() at server shutdown.
    },
  });
}
