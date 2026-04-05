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
  /** From amodal.json stores.backend. `pglite` if unset. */
  backend?: 'pglite' | 'postgres';
  /** From amodal.json stores.postgresUrl. May be an `env:VAR_NAME` reference. */
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
 *   1. If `backend === 'postgres'` and a resolved URL is available →
 *      `PostgresSessionStore`.
 *   2. If `backend === 'postgres'` but URL is missing or fails to
 *      connect → log and fall back to PGLite. The session store must
 *      always be available; a missing URL shouldn't crash the runtime.
 *   3. Otherwise → `PGLiteSessionStore` (default).
 *
 * Resolving `env:VAR_NAME` is intentionally mirrored from
 * `local-server.ts`'s store-backend selection so behavior is consistent
 * across both backends.
 */
export async function selectSessionStore(
  opts: SessionStoreSelectorOptions,
): Promise<SessionStore> {
  const {backend = 'pglite', postgresUrl, logger, dataDir} = opts;

  if (backend === 'postgres') {
    const url = resolveUrl(postgresUrl);
    if (!url) {
      logger.warn('session_store_postgres_url_missing', {
        configured: postgresUrl,
        fallback: 'pglite',
      });
    } else {
      try {
        // Dynamic import so `pg` stays optional for PGLite-only users.
        const mod = await import('./postgres-store.js');
        const store = new mod.PostgresSessionStore({
          connectionString: url,
          logger,
        });
        await store.initialize();
        return store;
      } catch (err) {
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

function resolveUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('env:')) {
    const varName = raw.slice(4);
    return process.env[varName];
  }
  return raw;
}
