/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Studio's database access layer.
 *
 * Wraps @amodalai/db with Studio-specific initialization
 * (ensuring schema is created on first access).
 */

import { getDb, ensureSchema } from '@amodalai/db';
import type { Db } from '@amodalai/db';
import { logger } from './logger';

let initialized = false;

/**
 * Get the shared Drizzle database instance, ensuring the schema
 * has been created on first call.
 */
export async function getStudioDb(): Promise<Db> {
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
 * Reset the initialization flag. Used for testing only.
 */
export function resetStudioDb(): void {
  initialized = false;
}
