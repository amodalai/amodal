/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle schema for PGLite tables.
 *
 * Phase 3.4 defines `agentSessions` here. Phase 4.3b will add store
 * tables to this same file so both migrate together when we move from
 * PGLite to Postgres.
 */

import {pgTable, text, integer, jsonb, timestamp} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  messages: jsonb('messages').notNull().$type<unknown[]>(),
  tokenUsage: jsonb('token_usage').notNull().$type<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>(),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
