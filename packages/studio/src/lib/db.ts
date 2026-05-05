/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Studio's database access layer.
 *
 * Two modes:
 *   1. Legacy / local-dev: `getStudioDb()` lazily creates a pg.Pool-backed
 *      Drizzle instance via `@amodalai/db`'s `getDb()` and runs `ensureSchema`
 *      once on first access.
 *   2. Cloud / serverless: an external deployment calls
 *      `setStudioDbProvider(() => myNeonHttpDb)` at startup. `getStudioDb()`
 *      then returns the injected db on every call. The deployment is
 *      responsible for schema bootstrap (e.g. drizzle-kit push at deploy).
 */

import { getDb, ensureSchema } from '@amodalai/db';
import type { Db } from '@amodalai/db';
import { logger } from './logger';

let initialized = false;
let dbProvider: (() => Db | Promise<Db>) | null = null;

/**
 * Inject a custom db source. When set, `getStudioDb()` calls this on every
 * invocation and skips the legacy pg.Pool / `ensureSchema` path. The caller
 * owns schema bootstrap (typically drizzle-kit push or migrate at deploy).
 *
 * Used by serverless deployments (e.g. cloud-studio on Vercel) to supply a
 * neon-http-backed Drizzle instance instead of the default pg.Pool.
 */
export function setStudioDbProvider(
  provider: () => Db | Promise<Db>,
): void {
  dbProvider = provider;
}

/**
 * Get the Drizzle database instance.
 *
 * If a custom provider is registered (via `setStudioDbProvider`), returns
 * the provider's db. Otherwise lazily creates a pg.Pool-backed instance via
 * `@amodalai/db` and runs `ensureSchema` once on first access.
 */
export async function getStudioDb(): Promise<Db> {
  if (dbProvider) return dbProvider();

  const db = getDb(); // reads DATABASE_URL from env
  if (!initialized) {
    const start = Date.now();
    // ensureSchema expects unparameterized NodePgDatabase; our Db carries
    // schema generics. Both expose .execute() identically, so the cast is
    // safe at this module boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any
    await ensureSchema(db as any);
    initialized = true;
    logger.info('studio_db_initialized', { duration_ms: Date.now() - start });
  }
  return db;
}

/**
 * Reset the initialization flag and clear any injected provider.
 * Used for testing only.
 */
export function resetStudioDb(): void {
  initialized = false;
  dbProvider = null;
}
