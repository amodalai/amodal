/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `SetupPlan` — the deterministic, derived contract the admin agent
 * walks through during onboarding. Phase C of the admin-setup build
 * plan.
 *
 * The Plan is composed by `composePlan` in `@amodalai/core/cards/setup-plan.ts`
 * from three existing sources the template author already authored for
 * other reasons:
 *
 *   1. `template.json#connections[]` — slot label, description, options[], required, multi.
 *   2. Each option's `package.json#amodal` — displayName, auth metadata, OAuth scopes.
 *   3. `automations/*.{json,md}` — schedule defaults + display title.
 *
 * Optional polish (`template.json#setup` block, see `SetupPolish`)
 * shallow-merges over the composed Plan to add author voice without
 * changing the deterministic structure.
 *
 * The Plan persists into `setup_state.plan` (Phase B) so the agent
 * can resume across sessions without recomposing.
 */

// ---------------------------------------------------------------------------
// Slots — connection requirements
// ---------------------------------------------------------------------------

/**
 * One package option for a connection slot. When a slot has multiple
 * options (e.g. CRM = HubSpot or Salesforce), the agent presents an
 * `ask_choice` to pick one before emitting the Connect card.
 */
export interface SetupPlanSlotOption {
  /** npm package name (e.g. "@amodalai/connection-slack"). */
  packageName: string;
  /** Human-readable label from `package.json#amodal.displayName`. */
  displayName: string;
  /**
   * Auth type the connection package declares — drives whether the
   * Configure modal renders OAuth + paste fallback, paste-only, or
   * basic-auth fields. Mirrors `package.json#amodal.auth.type`.
   */
  authType: 'oauth2' | 'bearer' | 'api-key' | 'basic' | 'none' | 'unknown';
  /**
   * OAuth scopes shown beneath the Connect button as "What we'll
   * read." Empty when the package has no OAuth metadata. Pulled from
   * `package.json#amodal.oauth.scopes`.
   */
  oauthScopes: string[];
  /** Optional icon URL pulled from `package.json#amodal.icon`. */
  icon?: string;
  /** Optional category pulled from `package.json#amodal.category`. */
  category?: string;
}

/**
 * One slot in a Plan. The author authors these in
 * `template.json#connections[]`; `composePlan` enriches each option
 * with metadata pulled from the option's installed package.
 */
export interface SetupPlanSlot {
  /** User-visible slot label (e.g. "CRM", "Slack", "Web analytics"). */
  label: string;
  /** Why-copy the agent reads verbatim ("Where leads and deals live..."). */
  description: string;
  /** True when the agent must walk this slot before completion. */
  required: boolean;
  /** True when the user can connect more than one option (e.g. multiple ad platforms). */
  multi: boolean;
  /** Resolved metadata for each option the author listed. */
  options: SetupPlanSlotOption[];
}

// ---------------------------------------------------------------------------
// Configuration questions
// ---------------------------------------------------------------------------

/**
 * Single configuration question the agent asks during the
 * `configuring` phase. Currently driven by automation files
 * (`schedule` becomes a config question with `[Monday 8am] [Friday
 * 4pm] [Custom]`); future templates may add their own.
 */
export interface SetupPlanConfigQuestion {
  /** Stable key used in `setup_state.configAnswers`. */
  key: string;
  /** User-visible question text. */
  question: string;
  /** Choice options shown as button row. The first option is the default (highlighted). */
  options: Array<{label: string; value: string}>;
  /**
   * Optional one-sentence reasoning the agent surfaces below the
   * buttons ("gives your team the numbers before standup"). Populated
   * by the optional `template.json#setup.scheduleReasoning` polish.
   */
  reasoning?: string;
  /** True when this answer is required for completion. */
  required: boolean;
}

// ---------------------------------------------------------------------------
// Completion preview
// ---------------------------------------------------------------------------

/**
 * Data the agent uses to render the completion preview card and the
 * post-setup follow-up suggestions.
 */
export interface SetupPlanCompletion {
  /** Human title for the agent ("Monday Marketing Digest"). */
  title: string;
  /**
   * Optional 3-5 example prompts the agent surfaces as "you can
   * change anything by chatting" hints. Pulled from the optional
   * `template.json#setup.completionSuggestions` polish.
   */
  suggestions: string[];
  /**
   * The automation's title ("Weekly marketing digest") used in the
   * completion summary. Pulled from the first automation file.
   */
  automationTitle: string | null;
}

// ---------------------------------------------------------------------------
// Optional polish (template author voice)
// ---------------------------------------------------------------------------

/**
 * Shape the optional `template.json#setup` block can take. Templates
 * that don't author this block fall through to generic copy. The
 * fields here are the ones the spec calls out; new fields can be
 * added with a default.
 */
export interface SetupPolish {
  /** Reasoning shown beneath the schedule choice ("gives your team the numbers before standup"). */
  scheduleReasoning?: string;
  /** Example prompts shown in the completion card. */
  completionSuggestions?: string[];
  /**
   * Per-slot override of the validation data-point format string
   * (e.g. `{value} sessions this week`). Falls through to the
   * connection package's default when unset.
   */
  dataPointTemplates?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Top-level plan
// ---------------------------------------------------------------------------

/**
 * The Plan the admin agent walks through during onboarding. Both
 * Path A (click a template) and Path B (custom description) end at
 * the same Plan shape — the difference is who composes it (the
 * `composePlan` function for Path A, the agent itself for Path B).
 *
 * Persisted into `setup_state.plan` once the user confirms; the agent
 * reads it back on every turn instead of recomposing.
 */
export interface SetupPlan {
  /** npm package the Plan was composed against (e.g. "@amodalai/marketing-ops"). */
  templatePackage: string;
  /** Connection slots, in author-declared order. */
  slots: SetupPlanSlot[];
  /** Configuration questions for the `configuring` phase. */
  config: SetupPlanConfigQuestion[];
  /** Data for the completion preview. */
  completion: SetupPlanCompletion;
}
