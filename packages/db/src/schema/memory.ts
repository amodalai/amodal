/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent memory entries table — one row per memory fact.
 *
 * Scoped by app_id (same isolation model as store_documents).
 * Supports full-text search via GIN index on content.
 */

import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const agentMemoryEntries = pgTable(
  'agent_memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: text('app_id').notNull(),
    scopeId: text('scope_id').notNull().default(''),
    content: text('content').notNull(),
    category: text('category'),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => [
    index('idx_memory_entries_scope').on(t.appId, t.scopeId),
  ],
);

// Legacy single-row table — kept for backward compat during migration.
export const agentMemory = pgTable(
  'agent_memory',
  {
    id: integer('id').primaryKey().default(1),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
);
