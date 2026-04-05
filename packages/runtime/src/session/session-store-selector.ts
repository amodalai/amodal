/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Picks the right session-store factory given repo config.
 *
 * Extracted from `local-server.ts` so the selection logic is
 * unit-testable without spinning up the full server.
 */

import type {Logger} from '../logger.js';
import {SessionStoreError} from '../errors.js';
import type {SessionStore} from './store.js';
import {createPGLiteSessionStore} from './pglite-session-store.js';

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
 *      `createPostgresSessionStore`.
 *   2. If `backend === 'postgres'` but the URL is missing, **or the
 *      Postgres connection fails to initialize** → log the failure at
 *      `error` level and fall back to `createPGLiteSessionStore`. The
 *      session store must always be available; a missing URL or dead
 *      DB should not crash the runtime on boot.
 *   3. If the Postgres backend rejects config at construct time
 *      (invalid `tableName`, missing options, etc.) → **rethrow**.
 *      Config typos in `amodal.json` are programmer errors that must
 *      fail fast — if they fell through to PGLite silently, every
 *      session would evaporate on restart with no visible signal.
 *   4. Otherwise → PGLite (default).
 *
 * **Fallback scope:** only connection-class failures (network, auth,
 * DDL) trigger the fallback. Construct-time validation is fatal.
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
        const mod = await import('./postgres-session-store.js');
        return await mod.createPostgresSessionStore({
          connectionString: postgresUrl,
          logger,
        });
      } catch (err) {
        // Construct-time validation errors are programmer errors —
        // fail fast so operators notice the amodal.json typo.
        if (err instanceof SessionStoreError && err.operation === 'construct') {
          throw err;
        }
        // Connection-class failure — log and fall back to PGLite.
        logger.error('session_store_postgres_init_failed', {
          error: err instanceof Error ? err.message : String(err),
          fallback: 'pglite',
        });
      }
    }
  }

  return createPGLiteSessionStore({logger, dataDir});
}
