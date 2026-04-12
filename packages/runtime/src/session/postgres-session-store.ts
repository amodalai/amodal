/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres factory for the session store.
 *
 * Uses the shared `getDb()` singleton from `@amodalai/db` and returns
 * a `DrizzleSessionStore` wired to it. Schema migration is handled by
 * `ensureSchema()` at server startup — this factory only wires the store.
 */

import {getDb, agentSessions} from '@amodalai/db';

import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';
import {DrizzleSessionStore} from './drizzle-session-store.js';
import type {SessionStoreHooks} from './store.js';

const BACKEND_NAME = 'postgres';

export interface PostgresSessionStoreOptions {
  /** Postgres connection string. Ignored — getDb reads DATABASE_URL. Kept for backwards compat. */
  connectionString?: string;
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
  /** Optional hooks for dual-write / observability. */
  hooks?: SessionStoreHooks;
}

/**
 * Create and initialize a Postgres-backed session store.
 *
 * Uses the shared `getDb()` connection. `ensureSchema()` must have
 * been called before this function.
 */
export async function createPostgresSessionStore(
  optsOrUrl: PostgresSessionStoreOptions | string,
): Promise<DrizzleSessionStore> {
  const opts: PostgresSessionStoreOptions =
    typeof optsOrUrl === 'string' ? {connectionString: optsOrUrl} : optsOrUrl;

  const logger = opts.logger ?? defaultLogger;
  const db = getDb();

  logger.info('session_store_initialized', {
    backend: BACKEND_NAME,
  });

  return new DrizzleSessionStore({
    db,
    table: agentSessions,
    backendName: BACKEND_NAME,
    logger,
    hooks: opts.hooks,
    onClose: async () => {
      // Connection pool is owned by the @amodalai/db singleton.
    },
  });
}
