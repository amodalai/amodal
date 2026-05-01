/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-domain query module for the `setup_state` table — Phase B of the
 * admin-setup build plan. Functions take `db` as the first arg and
 * return typed results (the Midday pattern). No facade, no
 * over-the-wire DTOs — just typed Drizzle queries.
 *
 * `upsertSetupState` does its merges in SQL via JSONB concatenation
 * (`||`) and `jsonb_set` so concurrent tool calls in the same turn
 * don't race on read-modify-write. Postgres row-level locks on UPDATE
 * serialize the writes.
 *
 * The agent never sees the row's identity columns or timestamps in
 * the returned `SetupState` — it sees the JSONB-derived shape only,
 * matching the @amodalai/types/setup-state.ts contract.
 */

import {and, eq, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

import type {
  SetupState,
  SetupStatePatch,
  CompletedSlot,
  SkippedSlot,
  ConfigAnswers,
  DeferredRequest,
  ProvidedContext,
  SetupPlanSnapshot,
  SetupPhase,
} from '@amodalai/types';
import {emptySetupState} from '@amodalai/types';

import {setupState} from '../schema/setup-state.js';

type Db = NodePgDatabase<Record<string, unknown>>;

/**
 * Read the live setup state for `(agentId, scopeId)`. Returns null if
 * no row exists — the caller (typically the `read_setup_state` tool)
 * decides whether to treat that as "fresh setup" or as an error.
 */
export async function getSetupState(
  db: Db,
  agentId: string,
  scopeId: string,
): Promise<{state: SetupState; completedAt: Date | null} | null> {
  const rows = await db
    .select()
    .from(setupState)
    .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const state: SetupState = {
    phase: row.phase,
    currentStep: row.currentStep === null ? null : Number(row.currentStep),
    completed: row.completed,
    skipped: row.skipped,
    configAnswers: row.configAnswers,
    deferredRequests: row.deferredRequests,
    providedContext: row.providedContext,
    plan: row.plan ?? null,
  };
  return {state, completedAt: row.completedAt};
}

/**
 * Upsert the row keyed by `(agentId, scopeId)` and apply the `patch`.
 *
 * - Top-level fields (`phase`, `currentStep`, `plan`) overwrite when
 *   present in the patch.
 * - List fields (`appendCompleted`, `appendSkipped`,
 *   `appendDeferredRequests`) append via JSONB concatenation —
 *   pass a single-element array to add one entry.
 * - Map fields (`mergeConfigAnswers`, `mergeProvidedContext`) merge
 *   key-by-key via JSONB `||` concatenation.
 *
 * Returns the post-patch state. When no row existed and the patch is
 * non-empty, the row is created from `emptySetupState()` first.
 */
export async function upsertSetupState(
  db: Db,
  agentId: string,
  scopeId: string,
  patch: SetupStatePatch,
): Promise<{state: SetupState; completedAt: Date | null}> {
  // Insert-or-update via ON CONFLICT, with JSONB merges in SQL.
  //
  // For the INSERT branch: seed each list/map column from the patch
  // (or the empty default).
  //
  // For the UPDATE branch: concatenate the patch's lists and merge
  // its maps using `existing || patch` (jsonb concat).
  const seed = emptySetupState();
  const insertRow = {
    agentId,
    scopeId,
    phase: (patch.phase ?? seed.phase),
    currentStep: patch.currentStep === null || patch.currentStep === undefined
      ? null
      : String(patch.currentStep),
    completed: patch.appendCompleted ?? seed.completed,
    skipped: patch.appendSkipped ?? seed.skipped,
    configAnswers: patch.mergeConfigAnswers ?? seed.configAnswers,
    deferredRequests: patch.appendDeferredRequests ?? seed.deferredRequests,
    providedContext: patch.mergeProvidedContext ?? seed.providedContext,
    plan: patch.plan === undefined ? seed.plan : patch.plan,
  };

  // Build the UPDATE set clause. Each field is conditionally overridden
  // when the patch provides it; otherwise we leave the existing value.
  const updateSet: Record<string, unknown> = {
    updatedAt: sql`NOW()`,
  };
  if (patch.phase !== undefined) updateSet['phase'] = patch.phase;
  if (patch.currentStep !== undefined) {
    updateSet['currentStep'] = patch.currentStep === null ? null : String(patch.currentStep);
  }
  if (patch.appendCompleted && patch.appendCompleted.length > 0) {
    updateSet['completed'] = sql`${setupState.completed} || ${JSON.stringify(patch.appendCompleted)}::jsonb`;
  }
  if (patch.appendSkipped && patch.appendSkipped.length > 0) {
    updateSet['skipped'] = sql`${setupState.skipped} || ${JSON.stringify(patch.appendSkipped)}::jsonb`;
  }
  if (patch.mergeConfigAnswers && Object.keys(patch.mergeConfigAnswers).length > 0) {
    updateSet['configAnswers'] = sql`${setupState.configAnswers} || ${JSON.stringify(patch.mergeConfigAnswers)}::jsonb`;
  }
  if (patch.appendDeferredRequests && patch.appendDeferredRequests.length > 0) {
    updateSet['deferredRequests'] = sql`${setupState.deferredRequests} || ${JSON.stringify(patch.appendDeferredRequests)}::jsonb`;
  }
  if (patch.mergeProvidedContext && Object.keys(patch.mergeProvidedContext).length > 0) {
    updateSet['providedContext'] = sql`${setupState.providedContext} || ${JSON.stringify(patch.mergeProvidedContext)}::jsonb`;
  }
  if (patch.plan !== undefined) {
    updateSet['plan'] = patch.plan;
  }

  await db
    .insert(setupState)
    .values(insertRow)
    .onConflictDoUpdate({
      target: [setupState.agentId, setupState.scopeId],
      set: updateSet,
    });

  // Re-read so the caller sees the post-patch state — including any
  // JSONB merges that happened server-side.
  const fresh = await getSetupState(db, agentId, scopeId);
  if (!fresh) {
    throw new Error(
      `setup_state row vanished after upsert for (${agentId}, ${scopeId}) — concurrent delete?`,
    );
  }
  return fresh;
}

/**
 * Stamp `completed_at` on the row, marking setup done. Phase E's
 * `commit_setup` primitive is the only caller. Idempotent — calling
 * twice is safe; the second call leaves `completedAt` unchanged.
 *
 * Returns the row's `completedAt` after the call, or null if no row
 * exists for `(agentId, scopeId)` (caller should treat that as a bug
 * — `commit_setup` should never run before the row is created).
 */
export async function markComplete(
  db: Db,
  agentId: string,
  scopeId: string,
): Promise<Date | null> {
  const rows = await db
    .update(setupState)
    .set({
      phase: 'complete' as SetupPhase,
      completedAt: sql`COALESCE(completed_at, NOW())`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)))
    .returning({completedAt: setupState.completedAt});

  return rows[0]?.completedAt ?? null;
}

/**
 * Phase H.11 — server-side reconciliation. Given the live env-var
 * `connectionsStatus` map (from `/api/connections-status`), update the
 * row so:
 *   - any package with `configured: true` whose slot label isn't in
 *     `state.completed[]` gets a synthetic CompletedSlot appended
 *     (using `nowIso` as both connectedAt and validatedAt — the user
 *     configured this out-of-band, we don't have a real validate
 *     timestamp), and
 *   - any package with `configured: true` that appears in
 *     `state.skipped[]` is filtered out of `skipped[]`.
 *
 * This makes "the agent's read of where am I" match reality on
 * session bootstrap when the user configured a connection out-of-band
 * (per-connection page, manual `.env` edit). The Plan must be
 * attached for this to work — without slot labels we can't synthesize
 * a CompletedSlot. Returns the post-reconcile state, or the input
 * state unchanged when there's nothing to reconcile.
 *
 * Idempotent — calling twice with the same status map is a no-op.
 */
export async function reconcileSetupState(
  db: Db,
  agentId: string,
  scopeId: string,
  connectionsStatus: Record<string, {configured: boolean}>,
  nowIso: string = new Date().toISOString(),
): Promise<{state: SetupState; completedAt: Date | null} | null> {
  const current = await getSetupState(db, agentId, scopeId);
  if (!current) return null;
  const {state} = current;

  const plan = state.plan;
  if (!plan) {
    // No plan attached → no slot labels to synthesize CompletedSlot
    // entries against. Reconciliation is a no-op until the plan lands.
    return current;
  }

  const configuredPackages = new Set(
    Object.entries(connectionsStatus)
      .filter(([, v]) => v.configured)
      .map(([k]) => k),
  );
  if (configuredPackages.size === 0) return current;

  // Build the slot-label lookup from the plan.
  const labelByPackage = new Map<string, string>();
  for (const slot of plan.slots) {
    for (const option of slot.options) {
      if (configuredPackages.has(option.packageName) && !labelByPackage.has(option.packageName)) {
        labelByPackage.set(option.packageName, slot.label);
      }
    }
  }

  // Decide which packages need to be appended to completed[].
  const completedPackageKeys = new Set(
    state.completed.map((c) => `${c.packageName}::${c.slotLabel}`),
  );
  const toAppend: CompletedSlot[] = [];
  for (const [packageName, label] of labelByPackage) {
    const key = `${packageName}::${label}`;
    if (completedPackageKeys.has(key)) continue;
    toAppend.push({
      slotLabel: label,
      packageName,
      connectedAt: nowIso,
      validatedAt: nowIso,
      validationFormatted: null,
    });
  }

  // Decide which entries to drop from skipped[].
  const filteredSkipped = state.skipped.filter(
    (s) => !configuredPackages.has(s.packageName),
  );
  const skippedChanged = filteredSkipped.length !== state.skipped.length;

  if (toAppend.length === 0 && !skippedChanged) {
    return current;
  }

  const updateSet: Record<string, unknown> = {updatedAt: sql`NOW()`};
  if (toAppend.length > 0) {
    updateSet['completed'] = sql`${setupState.completed} || ${JSON.stringify(toAppend)}::jsonb`;
  }
  if (skippedChanged) {
    updateSet['skipped'] = filteredSkipped;
  }

  await db
    .update(setupState)
    .set(updateSet)
    .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)));

  return getSetupState(db, agentId, scopeId);
}

/**
 * Delete the row for `(agentId, scopeId)`. Phase E.10 — `cancel_setup`
 * uses this when the user says "actually I want a different template."
 * Returns true when a row existed and was deleted, false otherwise.
 *
 * This is the only place the row is destroyed. Post-commit, the row
 * lives forever (with `completed_at` set) for analytics + "you
 * mentioned X earlier" follow-up handling — `cancel_setup` is
 * pre-commit only; the prompt should refuse to call it after
 * `phase === 'complete'`.
 */
export async function deleteSetupState(
  db: Db,
  agentId: string,
  scopeId: string,
): Promise<boolean> {
  const rows = await db
    .delete(setupState)
    .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)))
    .returning({agentId: setupState.agentId});
  return rows.length > 0;
}

/**
 * Wipe every `setup_state` row matching `scopeId`, regardless of
 * `agentId`. Used by the onboarding chat's "Restart setup" flow —
 * the agent-id can shift mid-flow when `install_template` writes
 * `amodal.json` (which the CLI reads at startup to populate
 * `AGENT_ID`), so a strict `(agentId, scopeId)` match would miss
 * rows seeded before the rename. Returns the number of rows deleted.
 */
export async function deleteSetupStateByScope(
  db: Db,
  scopeId: string,
): Promise<number> {
  const rows = await db
    .delete(setupState)
    .where(eq(setupState.scopeId, scopeId))
    .returning({agentId: setupState.agentId});
  return rows.length;
}

// Re-export the row types so consumers don't have to chase imports.
export type {
  CompletedSlot,
  SkippedSlot,
  ConfigAnswers,
  DeferredRequest,
  ProvidedContext,
  SetupPlanSnapshot,
};
