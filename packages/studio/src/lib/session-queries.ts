/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for reading session data from Postgres.
 * Used by Studio's session pages.
 */

import { eq, desc, agentSessions } from '@amodalai/db';
import { getStudioDb } from './db';

const DEFAULT_SESSION_LIMIT = 100;

/**
 * List sessions, ordered by most recently updated.
 */
export async function listSessions(opts?: { limit?: number }) {
  const db = await getStudioDb();
  const limit = opts?.limit ?? DEFAULT_SESSION_LIMIT;

  return db
    .select()
    .from(agentSessions)
    .orderBy(desc(agentSessions.updatedAt))
    .limit(limit);
}

/**
 * Get a single session by ID. Returns null if not found.
 */
export async function getSession(sessionId: string) {
  const db = await getStudioDb();
  const rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}
