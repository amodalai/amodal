/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `commitSetup` — idempotent commit primitive used by both the agent
 * tool (`request_complete_setup` / `force_complete_setup`) and the
 * Studio "Finish setup" button. Phase E.2 of the admin-setup build
 * plan.
 *
 * The function is the only thing that mutates `amodal.json` +
 * `setup_state.completed_at`. Order is intentional:
 *
 *   1. Read setup_state. If `completed_at` is non-null, return early
 *      — already complete.
 *   2. Validate readiness via `validateSetupReadiness`. If not ready
 *      and `!force`, throw `SetupNotReadyError(warnings)` so the
 *      caller can surface a soft warning to the user.
 *   3. Write `amodal.json` via the fs backend.
 *   4. Mark the row complete in the DB.
 *
 * File-first / DB-second is deliberate. If step 4 fails (Postgres
 * flake, runtime crash), the next session sees `amodal.json` exists
 * + `completed_at IS NULL` and finalizes the DB on session open
 * (Phase E.8 belt-and-suspenders).
 *
 * The reverse ordering would leave the agent in a half-committed
 * state where the DB says "done" but the runtime can't actually
 * boot from the on-disk config, which is much harder to recover.
 */

import type {
  AmodalConfig,
  ConnectionsStatusMap,
  SetupPlan,
  SetupState,
  SetupWarning,
} from '@amodalai/types';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

import {validateSetupReadiness} from '@amodalai/core';
import {
  getSetupState,
  markComplete,
} from '@amodalai/db';

import type {FsBackend} from '../tools/fs/index.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `commitSetup` when readiness validation fails and `force`
 * is not set. Carries the warnings so the caller (the `request_complete_setup`
 * tool or the user-button modal) can render a "you're missing X — finish
 * anyway?" affordance.
 */
export class SetupNotReadyError extends Error {
  readonly warnings: SetupWarning[];

  constructor(warnings: SetupWarning[]) {
    super(
      `Setup is not ready to commit (${String(warnings.length)} warning${warnings.length === 1 ? '' : 's'})`,
    );
    this.name = 'SetupNotReadyError';
    this.warnings = warnings;
  }
}

/** Returned when the row is already complete or commit succeeded. */
export interface CommitSetupSuccess {
  ok: true;
  alreadyComplete: boolean;
  completedAt: Date;
}

/**
 * Soft-fail shape: the caller can branch on `reason` instead of
 * try/catching `SetupNotReadyError`. The agent's tool surfaces these
 * directly to the LLM.
 */
export interface CommitSetupNotReady {
  ok: false;
  reason: 'not_ready';
  warnings: SetupWarning[];
}

export interface CommitSetupNoState {
  ok: false;
  reason: 'no_state';
  message: string;
}

export type CommitSetupResult =
  | CommitSetupSuccess
  | CommitSetupNotReady
  | CommitSetupNoState;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type Db = NodePgDatabase<Record<string, unknown>>;

export interface CommitSetupOptions {
  db: Db;
  fs: FsBackend;
  agentId: string;
  scopeId: string;
  /** Skip the readiness check and commit anyway. Used by the user-button "Finish anyway" path. */
  force?: boolean;
  /**
   * Optional live env-var status from /api/connections-status (Phase
   * H.9). Forwarded to validateSetupReadiness so a slot the agent
   * never recorded but has env vars set still counts as configured.
   */
  connectionsStatus?: ConnectionsStatusMap;
}

export async function commitSetup(
  options: CommitSetupOptions,
): Promise<CommitSetupResult> {
  // WARN level so the CLI's quiet filter passes it — helps debug the
  // "setup completes but Studio still says in_progress" case where
  // commit-setup and repo-state disagree on agent_id.
  // eslint-disable-next-line no-console
  console.warn(`[WARN] commit_setup_start_DIAG ${JSON.stringify({agentId: options.agentId, scopeId: options.scopeId, force: options.force})}`);

  // 1. Read setup_state.
  const row = await getSetupState(options.db, options.agentId, options.scopeId);
  if (!row) {
    return {
      ok: false,
      reason: 'no_state',
      message: `No setup_state row exists for (${options.agentId}, ${options.scopeId}). Did the agent skip the planning phase?`,
    };
  }

  // 2. Already complete? Return idempotently with the existing timestamp.
  if (row.completedAt) {
    return {ok: true, alreadyComplete: true, completedAt: row.completedAt};
  }

  // 3. Validate readiness unless `force` is set.
  if (!options.force) {
    if (!row.state.plan) {
      // No plan attached — agent never confirmed Path B / never installed
      // a Path A template. Treat as "not ready" with a single block warning.
      return {
        ok: false,
        reason: 'not_ready',
        warnings: [
          {
            kind: 'missing_required_slot',
            severity: 'block',
            target: '<plan>',
            message: 'No Plan attached to setup_state — confirm a template or proposal first.',
          },
        ],
      };
    }
    const readiness = validateSetupReadiness({
      state: row.state,
      plan: row.state.plan,
      ...(options.connectionsStatus ? {connectionsStatus: options.connectionsStatus} : {}),
    });
    if (!readiness.ready) {
      return {ok: false, reason: 'not_ready', warnings: readiness.warnings};
    }
  }

  // 4. Write amodal.json (file first; DB second so a DB failure
  // leaves an auto-recoverable state).
  const config = composeAmodalJson(row.state, row.state.plan);
  await options.fs.writeRepoFile('amodal.json', `${JSON.stringify(config, null, 2)}\n`);

  // 5. Mark complete. markComplete is idempotent — concurrent calls
  // race on the row lock; the first wins, the second sees the
  // existing completed_at and returns it unchanged.
  const completedAt = await markComplete(options.db, options.agentId, options.scopeId);
  // eslint-disable-next-line no-console
  console.warn(`[WARN] commit_setup_mark_complete_DIAG ${JSON.stringify({agentId: options.agentId, scopeId: options.scopeId, completedAt: completedAt?.toISOString() ?? null})}`);
  if (!completedAt) {
    // Defensive: row vanished between step 1 and step 5 (concurrent delete?).
    // Treat as no_state — caller decides whether to retry.
    return {
      ok: false,
      reason: 'no_state',
      message: 'setup_state row was deleted while commit was in flight.',
    };
  }
  return {ok: true, alreadyComplete: false, completedAt};
}

// ---------------------------------------------------------------------------
// composeAmodalJson — derives a valid amodal.json from setup_state + Plan
// ---------------------------------------------------------------------------

/**
 * Build the `amodal.json` content the runtime needs to boot the
 * agent. Pulls the `name` from the Plan completion (or the agent's
 * id if completion is empty), seeds `version: '1.0.0'`, and lists
 * every distinct package from `state.completed[]` plus the template
 * itself when `plan.templatePackage` is non-empty.
 *
 * Exported separately so the Studio "preview before finish" panel
 * can render the same shape without committing.
 */
export function composeAmodalJson(
  state: SetupState,
  plan: SetupPlan | null,
): AmodalConfig {
  const name = sanitizeName(plan?.completion.title) ?? 'agent';
  const packages = collectPackages(state, plan);
  const config: AmodalConfig = {
    name,
    version: '1.0.0',
  };
  if (packages.length > 0) {
    config.packages = packages;
  }
  return config;
}

function collectPackages(state: SetupState, plan: SetupPlan | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // Template package first when present (so npm install resolves the
  // template's peer-deps before the connection packages).
  if (plan?.templatePackage && plan.templatePackage.length > 0) {
    seen.add(plan.templatePackage);
    out.push(plan.templatePackage);
  }

  // Every connection the user actually completed.
  for (const slot of state.completed) {
    if (seen.has(slot.packageName)) continue;
    seen.add(slot.packageName);
    out.push(slot.packageName);
  }

  return out;
}

/**
 * `name` is constrained by AmodalConfigSchema (min length 1). Strip
 * non-name characters and lower-case so a humanized completion title
 * like "Marketing Operations Hub" becomes "marketing-operations-hub".
 */
function sanitizeName(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // Cap input length up front so the trim regexes below run on a bounded
  // string — guards against ReDoS on adversarial repeated-dash inputs.
  const bounded = value.slice(0, 200);
  const normalized = bounded
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80);
  return normalized.length > 0 ? normalized : null;
}
