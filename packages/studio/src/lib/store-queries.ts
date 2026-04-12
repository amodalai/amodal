/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for reading store data from Postgres.
 * Used by Studio's store pages (Server Components).
 */

import { eq, desc, and, count, storeDocuments, storeDocumentVersions } from '@amodalai/db';
import { getStudioDb } from './db';

/**
 * List all stores for an agent, with document counts.
 */
export async function listStores(agentId: string) {
  const db = await getStudioDb();
  return db
    .select({ store: storeDocuments.store, docCount: count() })
    .from(storeDocuments)
    .where(eq(storeDocuments.appId, agentId))
    .groupBy(storeDocuments.store);
}

/**
 * List documents in a specific store, ordered by most recently updated.
 */
export async function listDocuments(
  agentId: string,
  store: string,
  opts?: { limit?: number; offset?: number },
) {
  const db = await getStudioDb();
  let query = db
    .select()
    .from(storeDocuments)
    .where(and(eq(storeDocuments.appId, agentId), eq(storeDocuments.store, store)))
    .orderBy(desc(storeDocuments.updatedAt))
    .$dynamic();

  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset) query = query.offset(opts.offset);

  return query;
}

/**
 * Get a single document by key. Returns null if not found.
 */
export async function getDocument(agentId: string, store: string, key: string) {
  const db = await getStudioDb();
  const rows = await db
    .select()
    .from(storeDocuments)
    .where(
      and(
        eq(storeDocuments.appId, agentId),
        eq(storeDocuments.store, store),
        eq(storeDocuments.key, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get the version history for a document, ordered newest-first.
 */
export async function getDocumentHistory(agentId: string, store: string, key: string) {
  const db = await getStudioDb();
  return db
    .select()
    .from(storeDocumentVersions)
    .where(
      and(
        eq(storeDocumentVersions.appId, agentId),
        eq(storeDocumentVersions.store, store),
        eq(storeDocumentVersions.key, key),
      ),
    )
    .orderBy(desc(storeDocumentVersions.version));
}
