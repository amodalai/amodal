/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Eval tables — suite definitions and run results.
 */

import {
  pgTable,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const evalSuites = pgTable(
  'eval_suites',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (t) => [
    index('idx_eval_suites_agent').on(t.agentId),
  ],
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    suiteId: text('suite_id').notNull(),
    model: jsonb('model').notNull().$type<Record<string, unknown>>(),
    results: jsonb('results').notNull().$type<unknown[]>(),
    passRate: real('pass_rate').notNull(),
    totalPassed: integer('total_passed').notNull(),
    totalFailed: integer('total_failed').notNull(),
    durationMs: integer('duration_ms').notNull(),
    costMicros: integer('cost_micros'),
    label: text('label'),
    gitSha: text('git_sha'),
    triggeredBy: text('triggered_by').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (t) => [
    index('idx_eval_runs_suite').on(t.suiteId),
    index('idx_eval_runs_agent').on(t.agentId),
  ],
);
