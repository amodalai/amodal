/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Picks the right `SessionStore` implementation given repo config.
 *
 * Extracted from `local-server.ts` so the selection logic is
 * unit-testable without spinning up the full server.
 */

import type {Logger} from '../logger.js';
import type {SessionStore} from './store.js';
import {PGLiteSessionStore} from './store.js';

export interface SessionStoreSelectorOptions {
  /** From amodal.json `stores.backend`. Defaults to `pglite` if unset. */
  backend?: 'pglite' | 'postgres';
  /**
   * Already-resolved Postgres connection string. Callers must resolve
   * any `env:VAR` reference upstream (see `resolveEnvRef` in
   * `../env-ref.ts`) — this function does not read `process.env`.
   */
  postgresUrl?: string;
  /** Logger for init and fallback events. */
  logger: Logger;
  /** Optional PGLite data dir (defaults to in-memory). */
  dataDir?: string;
}

/**
 * Select, construct, and initialize a `SessionStore`.
 *
 * Decision:
 *   1. If `backend === 'postgres'` and `postgresUrl` is set →
 *      `PostgresSessionStore`.
 *   2. If `backend === 'postgres'` but the URL is missing, **or the
 *      Postgres connection fails to initialize for any reason** → log
 *      the failure at `error` level and fall back to
 *      `PGLiteSessionStore`. The session store must always be
 *      available; a misconfigured Postgres URL should not crash the
 *      runtime on boot.
 *   3. Otherwise → `PGLiteSessionStore` (default).
 *
 * **Fallback trade-off:** step 2 swallows init errors deliberately.
 * Programmer errors (invalid `tableName`, unknown driver flag) will be
 * logged and hidden behind the fallback — operators must watch the
 * `session_store_postgres_init_failed` log line to detect them. This
 * is the product decision ("runtime must boot") taking precedence over
 * strict fail-fast semantics.
 */
export async function selectSessionStore(
  opts: SessionStoreSelectorOptions,
): Promise<SessionStore> {
  const {backend = 'pglite', postgresUrl, logger, dataDir} = opts;

  if (backend === 'postgres') {
    if (!postgresUrl) {
      logger.warn('session_store_postgres_url_missing', {fallback: 'pglite'});
    } else {
      try {
        // Dynamic import so `pg` stays optional for PGLite-only users.
        const mod = await import('./postgres-store.js');
        const store = new mod.PostgresSessionStore({
          connectionString: postgresUrl,
          logger,
        });
        await store.initialize();
        return store;
      } catch (err) {
        // Intentional fallback — see "Fallback trade-off" above.
        logger.error('session_store_postgres_init_failed', {
          error: err instanceof Error ? err.message : String(err),
          fallback: 'pglite',
        });
      }
    }
  }

  const store = new PGLiteSessionStore({logger, dataDir});
  await store.initialize();
  return store;
}
