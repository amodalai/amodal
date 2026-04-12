/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Automation tables — config and run history for scheduled agent tasks.
 */

import {
  pgTable,
  text,
  boolean,
  serial,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const automationConfig = pgTable(
  'automation_config',
  {
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    schedule: text('schedule').notNull(),
    message: text('message').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({columns: [t.agentId, t.name]}),
  ],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: serial('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    sessionId: text('session_id'),
    status: text('status').notNull(), // 'running' | 'completed' | 'failed'
    error: text('error'),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    completedAt: timestamp('completed_at', {withTimezone: true}),
  },
  (t) => [
    index('idx_automation_runs_agent').on(t.agentId, t.name),
  ],
);
