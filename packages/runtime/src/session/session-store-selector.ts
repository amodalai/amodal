/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Picks the right session-store factory given repo config.
 *
 * All paths now use Postgres via the shared
 * `getDb()` singleton from `@amodalai/db`. The `backend` option is
 * kept for backwards compat but is effectively ignored — Postgres is
 * always used. `DATABASE_URL` must be set.
 */

import type {Logger} from '../logger.js';
import type {SessionStore} from './store.js';
import {createPostgresSessionStore} from './postgres-session-store.js';

export interface SessionStoreSelectorOptions {
  /** From amodal.json `stores.backend`. Ignored — always uses Postgres. */
  backend?: string;
  /**
   * Already-resolved Postgres connection string. Ignored — getDb reads
   * DATABASE_URL from the environment.
   */
  postgresUrl?: string;
  /** Logger for init events. */
  logger: Logger;
  /** Ignored (legacy). */
  dataDir?: string;
}

/**
 * Select, construct, and initialize a `SessionStore`.
 *
 * Always returns a Postgres-backed session store via `getDb()`.
 */
export async function selectSessionStore(
  opts: SessionStoreSelectorOptions,
): Promise<SessionStore> {
  return createPostgresSessionStore({logger: opts.logger});
}
