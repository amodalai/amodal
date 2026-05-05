/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `validateSetupReadiness` — pure function that decides whether the
 * admin agent's setup state is ready to commit. Phase E.1 of the
 * admin-setup build plan.
 *
 * Single source of truth for "is setup actually done?" — used
 * identically by:
 *
 *   - the agent's `request_complete_setup` custom tool (Phase E.3);
 *   - the Studio "Finish setup" button via
 *     `/api/admin-chat/check-completion` (Phase E.5).
 *
 * Both paths render the same warnings to the user, and the same
 * `commit_setup` primitive guards on `ready` before mutating
 * `amodal.json` + `setup_state.completed_at`.
 *
 * Pure — depends on inputs only. No filesystem, no DB, no clock. The
 * caller pulls live setup_state via `ctx.setupState.read()` and (when
 * Phase H.9 lands) live env-var status via `/api/connections-status`,
 * then hands them in.
 */

import type {
  ConnectionsStatusMap,
  SetupPlan,
  SetupPlanSlot,
  SetupReadinessResult,
  SetupState,
  SetupWarning,
} from '@amodalai/types';

export interface ValidateSetupReadinessInput {
  /** The active setup state row's `state` field. */
  state: SetupState;
  /** The composed Plan attached to the row. */
  plan: SetupPlan;
  /**
   * Optional live env-var-derived status from Phase H.9's
   * `/api/connections-status`. When present, it overrides
   * `state.completed[]` for the "is this slot configured?" check —
   * Phase H.11's reconciliation keeps the two in sync but the live
   * env-var read is authoritative when there's drift.
   */
  connectionsStatus?: ConnectionsStatusMap;
}

/**
 * Validate the setup is ready to commit.
 *
 * Three classes of warning, in spec-listed order:
 *
 *   1. `missing_required_slot` (severity: block) — a slot in
 *      `plan.slots` with `required: true` whose options have none
 *      configured (per `state.completed[]` and, if available,
 *      `connectionsStatus`).
 *   2. `missing_config_answer` (severity: block) — a question in
 *      `plan.config` with `required: true` whose `key` isn't present
 *      in `state.configAnswers`.
 *   3. `skipped_with_impact` (severity: soft) — a slot the user
 *      explicitly skipped that the prompt's per-slot copy will
 *      surface as user-visible. We don't track impact metadata on
 *      slots yet (no field on the slot type today), so for Phase E
 *      this category is empty by default; templates can extend the
 *      Plan format to attach impact strings later.
 *
 * `ready` is true iff there are no `block` warnings. `soft` warnings
 * still get surfaced in the UI / chat copy but don't gate the
 * non-forced commit.
 */
export function validateSetupReadiness(
  input: ValidateSetupReadinessInput,
): SetupReadinessResult {
  const warnings: SetupWarning[] = [];

  // 1. Required slots without a configured option.
  for (const slot of input.plan.slots) {
    if (!slot.required) continue;
    if (isSlotConfigured(slot, input.state, input.connectionsStatus)) continue;
    warnings.push({
      kind: 'missing_required_slot',
      severity: 'block',
      target: slot.label,
      message: missingSlotMessage(slot),
    });
  }

  // 2. Required config answers missing.
  for (const question of input.plan.config) {
    if (!question.required) continue;
    if (input.state.configAnswers[question.key] !== undefined) continue;
    warnings.push({
      kind: 'missing_config_answer',
      severity: 'block',
      target: question.key,
      message: missingConfigMessage(question.key, question.question),
    });
  }

  // 3. Skipped slots with user-visible impact. Phase E ships this
  // as a hook with no current matches — slots don't yet carry an
  // `impactIfMissing` field. The agent's prompt surfaces the user's
  // explicit Later clicks separately; this category is for when a
  // skip needs an additional UI warning (e.g. a Studio side-panel
  // hint that the digest will be incomplete).

  const ready = warnings.every((w) => w.severity !== 'block');
  return {ready, warnings};
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * A slot is configured when ANY of its options is either:
 *   - in `state.completed[]` and `validatedAt` is non-null (or
 *     validation hasn't been required yet — connection-only Connect
 *     without a probe still counts), OR
 *   - flagged `configured: true` in the live `connectionsStatus`
 *     map.
 *
 * `state.completed[]` is the agent's record. `connectionsStatus` is
 * the runtime's read of `.env` / `secrets.env`. Phase H.11 keeps
 * them in sync; Phase E pre-H is `state.completed[]` only.
 */
function isSlotConfigured(
  slot: SetupPlanSlot,
  state: SetupState,
  connectionsStatus: ConnectionsStatusMap | undefined,
): boolean {
  for (const option of slot.options) {
    // Live env-var status wins when available — it's the runtime's
    // read of what credentials actually exist, not the agent's
    // record of what got connected.
    if (connectionsStatus?.[option.packageName]?.configured) return true;

    const completed = state.completed.find(
      (c) => c.packageName === option.packageName && c.slotLabel === slot.label,
    );
    if (completed) return true;
  }
  return false;
}

function missingSlotMessage(slot: SetupPlanSlot): string {
  const optionLabels = slot.options.map((o) => o.displayName).filter((n) => n.length > 0);
  if (optionLabels.length === 0) {
    return `${slot.label} isn't connected yet.`;
  }
  if (optionLabels.length === 1) {
    return `${slot.label} (${optionLabels[0]}) isn't connected yet.`;
  }
  // "CRM (HubSpot or Salesforce) isn't connected yet."
  const choices = formatChoiceList(optionLabels);
  return `${slot.label} (${choices}) isn't connected yet.`;
}

function missingConfigMessage(key: string, question: string): string {
  return `${humanizeKey(key)} isn't picked yet — "${question}"`;
}

function formatChoiceList(labels: string[]): string {
  if (labels.length <= 2) return labels.join(' or ');
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

function humanizeKey(key: string): string {
  // "slackChannel" -> "Slack channel"; "schedule" -> "Schedule".
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
