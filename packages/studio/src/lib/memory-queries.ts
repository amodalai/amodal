/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for reading/writing memory entries from Postgres.
 * Used by Studio's memory page and API routes.
 */

import { eq, and, sql, agentMemoryEntries } from '@amodalai/db';
import { getStudioDb } from './db';

/** Timeout for memory DB operations in Studio (ms). */
const DB_TIMEOUT_MS = 5_000;

/** Race a promise against a timeout to prevent hanging on a broken DB. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Memory query timed out: ${label}`)), DB_TIMEOUT_MS);
    }),
  ]);
}

/**
 * List all memory entries for an agent, ordered by creation time.
 */
export async function listMemoryEntries(agentId: string) {
  const db = await getStudioDb();
  return withTimeout(
    db
      .select()
      .from(agentMemoryEntries)
      .where(eq(agentMemoryEntries.appId, agentId))
      .orderBy(agentMemoryEntries.createdAt),
    'list',
  );
}

/**
 * Delete a memory entry by ID (scoped to agent).
 * Returns true if deleted, false if not found.
 */
export async function deleteMemoryEntry(agentId: string, entryId: string) {
  const db = await getStudioDb();
  const deleted = await withTimeout(
    db
      .delete(agentMemoryEntries)
      .where(
        and(
          eq(agentMemoryEntries.appId, agentId),
          sql`${agentMemoryEntries.id}::text LIKE ${entryId + '%'}`,
        ),
      )
      .returning({ id: agentMemoryEntries.id }),
    'delete',
  );
  return deleted.length > 0;
}

/**
 * Update a memory entry's content.
 * Returns the updated entry or null if not found.
 */
export async function updateMemoryEntry(agentId: string, entryId: string, content: string) {
  const db = await getStudioDb();
  const updated = await withTimeout(
    db
      .update(agentMemoryEntries)
      .set({ content, updatedAt: sql`NOW()` })
      .where(
        and(
          eq(agentMemoryEntries.appId, agentId),
          sql`${agentMemoryEntries.id}::text LIKE ${entryId + '%'}`,
        ),
      )
      .returning(),
    'update',
  );
  return updated[0] ?? null;
}

/**
 * Add a new memory entry.
 */
export async function addMemoryEntry(agentId: string, content: string) {
  const db = await getStudioDb();
  const [inserted] = await withTimeout(
    db
      .insert(agentMemoryEntries)
      .values({ appId: agentId, content })
      .returning(),
    'add',
  );
  return inserted;
}
