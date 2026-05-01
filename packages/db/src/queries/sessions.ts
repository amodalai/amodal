/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `agent_sessions` queries — Midday pattern. The runtime's session
 * store handles per-row save/load via the SessionStore interface;
 * these helpers cover scope-wide operations the runtime doesn't
 * (yet) expose, like the admin-chat restart wipe.
 */

import {eq} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

import {agentSessions} from '../schema/sessions.js';

type Db = NodePgDatabase<Record<string, unknown>>;

/**
 * Delete every `agent_sessions` row matching `scopeId`. Used by the
 * onboarding chat's "Restart setup" flow to wipe the in-memory chat
 * history at the DB level, not just clear localStorage. Returns the
 * number of rows deleted.
 */
export async function deleteAgentSessionsByScope(db: Db, scopeId: string): Promise<number> {
  const rows = await db
    .delete(agentSessions)
    .where(eq(agentSessions.scopeId, scopeId))
    .returning({id: agentSessions.id});
  return rows.length;
}
