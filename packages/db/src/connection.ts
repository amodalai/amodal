/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Database connection singleton — provides a shared Drizzle ORM instance
 * backed by a pg Pool. Reads DATABASE_URL from the environment if no URL
 * is passed explicitly.
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export type DbSchema = typeof schema;
export type Db = NodePgDatabase<DbSchema>;

export function createDbPool(url: string): Pool {
  return new Pool({connectionString: url, max: 10});
}

export function getDb(url?: string): Db {
  if (db) return db;
  const connectionString = url ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required. Set it in ~/.amodal/env or your agent .env file.',
    );
  }
  pool = createDbPool(connectionString);
  db = drizzle(pool, {schema});
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
