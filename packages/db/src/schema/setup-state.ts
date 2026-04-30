/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `setup_state` — durable per-(agent, scope) row that tracks where the
 * admin agent is in the onboarding conversation. Phase B of the
 * admin-setup build plan.
 *
 * One row per `(agent_id, scope_id)`. JSONB columns mirror the
 * `SetupState` interface in `@amodalai/types/setup-state.ts` — the
 * `$type<…>()` calls keep storage and query-module typing aligned.
 *
 * Concurrent writes are handled by Postgres row-level locking on
 * UPDATE; the query module performs JSONB merges in SQL (jsonb_set /
 * concatenation) so two tool calls firing in the same turn don't race.
 *
 * `completed_at` is the lone NULL-by-default column — when it flips
 * from NULL to a timestamp, setup is done. Phase E's `commit_setup`
 * primitive sets it.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

import type {
  SetupPhase,
  CompletedSlot,
  SkippedSlot,
  ConfigAnswers,
  DeferredRequest,
  ProvidedContext,
  SetupPlanSnapshot,
} from '@amodalai/types';

export const setupState = pgTable(
  'setup_state',
  {
    agentId: text('agent_id').notNull(),
    scopeId: text('scope_id').notNull().default(''),

    // Top-level phase + intra-phase progress. `phase` is the union
    // typed in @amodalai/types so callers can switch on it.
    phase: text('phase').notNull().$type<SetupPhase>().default('planning'),
    currentStep: text('current_step'),

    // Slot-completion history. Lists are append-only via the query
    // module's JSONB concatenation (jsonb || jsonb).
    completed: jsonb('completed').notNull().default([]).$type<CompletedSlot[]>(),
    skipped: jsonb('skipped').notNull().default([]).$type<SkippedSlot[]>(),

    // Final configuration answers (schedule, channel, …).
    configAnswers: jsonb('config_answers').notNull().default({}).$type<ConfigAnswers>(),

    // Side context the user volunteered + side requests deferred to
    // post-completion.
    deferredRequests: jsonb('deferred_requests').notNull().default([]).$type<DeferredRequest[]>(),
    providedContext: jsonb('provided_context').notNull().default({}).$type<ProvidedContext>(),

    // Plan snapshot. Phase C tightens the type to a typed SetupPlan.
    plan: jsonb('plan').$type<SetupPlanSnapshot | null>(),

    // Lifecycle timestamps. completedAt is null until commit_setup
    // (Phase E) sets it; once set, the agent transitions out of
    // guided mode.
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
    completedAt: timestamp('completed_at', {withTimezone: true}),
  },
  (t) => [
    primaryKey({columns: [t.agentId, t.scopeId]}),
    index('idx_setup_state_phase').on(t.phase),
    index('idx_setup_state_updated').on(t.updatedAt),
  ],
);
