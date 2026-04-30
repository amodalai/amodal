/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Durable setup state — Phase B of the admin-setup build plan.
 *
 * The admin agent reads its place in the onboarding conversation from
 * a single Postgres row keyed by `(agent_id, scope_id)`. Off-script
 * handling stops being conversation-history magic and becomes
 * deterministic: resume across reload, OAuth-popup-takes-forever,
 * network-blip — all "free."
 *
 * This module defines the TypeScript interface and a matching Zod
 * schema. The Drizzle table at `@amodalai/db/schema/setup-state.ts`
 * uses `$type<SetupState[K]>()` on each JSONB column so storage and
 * query-module typing both reference the same shape.
 *
 * The schema is intentionally additive-only post-launch — tool authors
 * and the admin agent's prompt depend on field names and the shape of
 * each value. Extend; never rename or remove.
 */

import {z} from 'zod';

// ---------------------------------------------------------------------------
// Phase enumeration
// ---------------------------------------------------------------------------

/**
 * High-level setup-flow phase. The admin agent advances through these
 * in order; off-script side-quests don't change `phase`, only the
 * agent's per-turn behavior.
 *
 * - `planning` — Path B (custom description) only. The agent is
 *   drafting a Plan from the user's free-form prompt; the user
 *   hasn't confirmed yet (`Looks right` button not clicked).
 * - `installing` — Template package + connection deps are being
 *   installed via npm.
 * - `connecting_required` — Walking required connections one at a
 *   time. Each Connect → validate → next.
 * - `connecting_optional` — Optional connection batch (checklist).
 * - `configuring` — Final 2-3 multiple-choice questions (schedule,
 *   destination channel, etc.).
 * - `complete` — Setup is done; `setup_state.completed_at` is set.
 *   The admin agent transitions out of guided mode.
 */
export const SETUP_PHASES = [
  'planning',
  'installing',
  'connecting_required',
  'connecting_optional',
  'configuring',
  'complete',
] as const;

export type SetupPhase = (typeof SETUP_PHASES)[number];

// ---------------------------------------------------------------------------
// Slot completion tracking
// ---------------------------------------------------------------------------

/**
 * One entry per connection slot the user finished. Captured per-slot
 * (not per-package) so multi-option slots like "CRM: HubSpot or
 * Salesforce" record which option was chosen.
 *
 * `validatedAt` flags whether `validate_connection` ran successfully
 * for this slot — a Connect that arrived but has not been validated
 * yet (e.g. the agent crashed mid-flow) shows up as `validatedAt:
 * null` so the next session knows to re-validate.
 */
export interface CompletedSlot {
  /** Slot label from the Plan (e.g. "Slack", "CRM"). */
  slotLabel: string;
  /** Package the user actually connected (e.g. "@amodalai/connection-slack"). */
  packageName: string;
  /** When the user finished the Connect flow. ISO-8601 timestamp. */
  connectedAt: string;
  /** When `validate_connection` last reported `ok: true`. */
  validatedAt: string | null;
  /** Optional formatted data point the agent surfaced ("Found 12 channels"). */
  validationFormatted: string | null;
}

/**
 * One entry per connection slot the user explicitly skipped.
 * `userSkipped: true` means the user clicked "Later" on the panel; an
 * env-var-only configuration (set by hand outside the chat) doesn't
 * populate this — it just shows up as `completed` on next reconcile.
 */
export interface SkippedSlot {
  slotLabel: string;
  packageName: string;
  /** When the user clicked Later. ISO-8601 timestamp. */
  skippedAt: string;
}

// ---------------------------------------------------------------------------
// Configuration answers + deferred requests + side context
// ---------------------------------------------------------------------------

/**
 * Per-key answers to Phase 4 configuration questions. Keys are the
 * Plan's `config[].key` (e.g. `schedule`, `slackChannel`). Values are
 * primitives the LLM can serialize cleanly.
 */
export type ConfigAnswers = Record<string, string | number | boolean>;

/**
 * Side requests the user asked about mid-flow that the agent deferred
 * to after completion. The completion message uses these to bridge
 * setup-mode and normal-mode invisibly ("You mentioned competitor
 * tracking earlier — want me to add that now?").
 */
export interface DeferredRequest {
  /** Free-form description of what the user asked for. */
  text: string;
  /** ISO-8601 timestamp of the user's turn. */
  capturedAt: string;
}

/**
 * Free-form context the user volunteered before the agent reached the
 * relevant question. The agent uses these to skip questions the user
 * already answered ("I'll post to #marketing like you mentioned").
 *
 * Keys are loose ("slackChannel", "schedule") — the agent matches them
 * to upcoming Plan questions during the configuring phase.
 */
export type ProvidedContext = Record<string, string>;

// ---------------------------------------------------------------------------
// Plan reference
// ---------------------------------------------------------------------------

/**
 * Plan attached to the setup_state row. Aliased to `SetupPlan` from
 * `./setup-plan.ts` (Phase C). The alias is preserved so older
 * codepaths that imported `SetupPlanSnapshot` keep compiling — Phase B
 * shipped this name as the loose `Record<string, unknown>` placeholder.
 */
export type SetupPlanSnapshot = import('./setup-plan.js').SetupPlan;

// ---------------------------------------------------------------------------
// Top-level interface
// ---------------------------------------------------------------------------

/**
 * The shape persisted as one row in the `setup_state` table.
 *
 * Identity (`agentId`, `scopeId`) lives on the Drizzle row, not in
 * this object — the query module reads/writes them as part of the
 * primary key. Timestamps (`createdAt`, `updatedAt`, `completedAt`)
 * also live on the row, not here, so the same shape ships through
 * `read_setup_state` to the LLM without leaking row-level metadata.
 */
export interface SetupState {
  phase: SetupPhase;
  /**
   * Optional intra-phase progress hint. The agent can use this to pick
   * the next required-connection slot or the next config question
   * without re-deriving from `completed[]` length.
   */
  currentStep: number | null;
  completed: CompletedSlot[];
  skipped: SkippedSlot[];
  configAnswers: ConfigAnswers;
  deferredRequests: DeferredRequest[];
  providedContext: ProvidedContext;
  /** Plan attached to this setup, populated after Path B confirmation or Path A install. */
  plan: SetupPlanSnapshot | null;
}

/** Empty `SetupState` for a fresh row. */
export function emptySetupState(phase: SetupPhase = 'planning'): SetupState {
  return {
    phase,
    currentStep: null,
    completed: [],
    skipped: [],
    configAnswers: {},
    deferredRequests: [],
    providedContext: {},
    plan: null,
  };
}

// ---------------------------------------------------------------------------
// Patch shape for partial updates
// ---------------------------------------------------------------------------

/**
 * Patch passed to `update_setup_state`. Top-level fields override; the
 * query module merges via JSONB concatenation in SQL so concurrent
 * tool calls don't race.
 *
 * Lists (`completed`, `skipped`, `deferredRequests`) are appended
 * by the query module rather than replaced — pass a single-element
 * array to add one entry. Maps (`configAnswers`, `providedContext`)
 * are merged key-by-key.
 *
 * To update `phase` or `currentStep`, pass them at the top level.
 */
export interface SetupStatePatch {
  phase?: SetupPhase;
  currentStep?: number | null;
  /** Append these slots to `completed[]`. */
  appendCompleted?: CompletedSlot[];
  /** Append these slots to `skipped[]`. */
  appendSkipped?: SkippedSlot[];
  /** Merge these keys into `configAnswers`. */
  mergeConfigAnswers?: ConfigAnswers;
  /** Append these to `deferredRequests[]`. */
  appendDeferredRequests?: DeferredRequest[];
  /** Merge these keys into `providedContext`. */
  mergeProvidedContext?: ProvidedContext;
  /** Replace the attached `plan` snapshot. Pass `null` to clear. */
  plan?: SetupPlanSnapshot | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const setupPhaseSchema = z.enum(SETUP_PHASES);

const completedSlotSchema: z.ZodType<CompletedSlot> = z.object({
  slotLabel: z.string(),
  packageName: z.string(),
  connectedAt: z.string(),
  validatedAt: z.string().nullable(),
  validationFormatted: z.string().nullable(),
});

const skippedSlotSchema: z.ZodType<SkippedSlot> = z.object({
  slotLabel: z.string(),
  packageName: z.string(),
  skippedAt: z.string(),
});

const configAnswersSchema: z.ZodType<ConfigAnswers> = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

const deferredRequestSchema: z.ZodType<DeferredRequest> = z.object({
  text: z.string(),
  capturedAt: z.string(),
});

const providedContextSchema: z.ZodType<ProvidedContext> = z.record(z.string(), z.string());

// SetupPlan has a deep structured shape (slots/config/completion);
// validating every nested field via Zod here would duplicate the TS
// interface and add maintenance cost without a real LLM-input
// boundary (the Plan is composed server-side, not LLM-supplied).
// `z.custom` accepts any value at runtime and carries the typed shape.
const setupPlanSnapshotSchema: z.ZodType<SetupPlanSnapshot> = z.custom<SetupPlanSnapshot>(
  (value) => typeof value === 'object' && value !== null,
);

export const setupStateSchema: z.ZodType<SetupState> = z.object({
  phase: setupPhaseSchema,
  currentStep: z.number().nullable(),
  completed: z.array(completedSlotSchema),
  skipped: z.array(skippedSlotSchema),
  configAnswers: configAnswersSchema,
  deferredRequests: z.array(deferredRequestSchema),
  providedContext: providedContextSchema,
  plan: setupPlanSnapshotSchema.nullable(),
});

export const setupStatePatchSchema: z.ZodType<SetupStatePatch> = z.object({
  phase: setupPhaseSchema.optional(),
  currentStep: z.number().nullable().optional(),
  appendCompleted: z.array(completedSlotSchema).optional(),
  appendSkipped: z.array(skippedSlotSchema).optional(),
  mergeConfigAnswers: configAnswersSchema.optional(),
  appendDeferredRequests: z.array(deferredRequestSchema).optional(),
  mergeProvidedContext: providedContextSchema.optional(),
  plan: setupPlanSnapshotSchema.nullable().optional(),
});
