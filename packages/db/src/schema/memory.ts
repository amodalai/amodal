/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent memory table — a single-row blob of text per database.
 *
 * In agent-per-tenant mode each instance has its own database,
 * so this table holds that instance's learned preferences and facts.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';

export const agentMemory = pgTable(
  'agent_memory',
  {
    id: integer('id').primaryKey().default(1),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
);
