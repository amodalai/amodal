/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline content blocks that custom tools can emit into the chat stream.
 *
 * The widget reducer's content-block switch and the Studio
 * `inlineBlockRenderers` registry both key off the `type` field. Adding a
 * new block type means: (1) extend the discriminated union here, (2) handle
 * it in the widget's reducer, (3) register a renderer (built-in for the
 * widget package, or via `inlineBlockRenderers` for Studio-only blocks).
 *
 * The union is **additive-only post-launch** — existing tool authors and
 * external surfaces depend on the shape of `Block` to render reliably.
 */

import type {AgentCard, AgentCardPreview} from './card-types.js';

/**
 * Plain prose written by a tool. Most tools don't need this — agent text
 * comes from the LLM stream — but a tool that wants to emit narrative
 * alongside a structured block can use `text`.
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * Single- or multi-select question rendered inline as a row of buttons.
 * The user's click posts the chosen `value` (or comma-joined values for
 * `multi: true`) as their next message; the agent's prompt should match
 * `askId` to a pending question so the reply is interpreted correctly.
 */
export interface AskChoiceBlock {
  type: 'ask_choice';
  /** Stable id for matching the reply back to the question. */
  askId: string;
  /** Short question shown above the buttons. */
  question: string;
  options: Array<{
    label: string;
    value: string;
    /**
     * Optional one-line description shown beneath the label. When any option
     * has a description, the card renders as a checkbox list rather than a
     * button row — used for optional-connection batches.
     */
    description?: string;
  }>;
  /** When true, the user can pick more than one option before submitting. */
  multi?: boolean;
}

/**
 * Inline preview of an agent card — used by the admin agent's
 * `show_preview` tool to surface a template's curated snippet (or an
 * expanded preview) in the chat.
 */
export interface AgentCardPreviewBlock {
  type: 'agent_card_preview';
  card: AgentCard;
  /** Optional expanded preview body. When present, the card may render a "see more" affordance. */
  preview?: AgentCardPreview;
}

/**
 * Connection slot panel rendered in the chat. The agent emits this to
 * present a connection (Slack, Resend, Twilio, etc.); the user clicks
 * Configure to open a modal that handles the auth-specific UI (OAuth
 * popup, paste fields, etc.).
 *
 * `state` is a cache of what the renderer last drew — Studio overwrites
 * it via reconciliation against real env-var state on every chat mount,
 * so it is never trusted blind. Only `userSkipped` survives reload.
 */
export interface ConnectionPanelBlock {
  type: 'connection_panel';
  /** Stable id for matching subsequent state updates back to this panel. */
  panelId: string;
  /** npm package providing the connection (e.g. "@amodalai/connection-slack"). */
  packageName: string;
  /** Human-readable name shown on the panel ("Slack"). */
  displayName: string;
  /** Short one-line description ("Where the digest gets posted"). */
  description: string;
  /** When true, the panel renders a Later button so the user can defer. */
  skippable: boolean;
  /** Last-rendered visual state — recomputed on every mount, not authoritative. */
  state: 'idle' | 'success' | 'skipped' | 'error';
  /**
   * Persisted hint that the user clicked Later on this panel. The only
   * field that survives reload; everything else is derived.
   *
   * Naming note: the admin-setup build plan describes this as
   * `meta.userSkipped`. The flat field here is functionally
   * equivalent and matches the convention used by other block types
   * (e.g. `state` is also flat on this block). No nested `meta`
   * sub-object.
   */
  userSkipped?: boolean;
  /** Optional inline data point shown beside the success state. */
  successDetail?: string;
  /** Optional error message shown beneath the panel in the error state. */
  errorMessage?: string;
}

/**
 * Plan proposal card emitted on Path B (custom description) — shows the
 * inferred set of skills + connections + optional connections in plain
 * English, with `Looks right` and `Adjust` buttons.
 *
 * `update_plan` re-renders the SAME card in place (matched by `proposalId`)
 * so the chat doesn't accumulate duplicate proposals during the Adjust
 * conversation.
 */
export interface ProposalBlock {
  type: 'proposal';
  proposalId: string;
  /** What the agent does, one short paragraph. */
  summary: string;
  /** Skill display names (never package names). */
  skills: Array<{label: string; description: string}>;
  /** Required connection slots, by display label ("CRM", "Slack"). */
  requiredConnections: Array<{label: string; description: string}>;
  /** Optional connection slots, by display label. */
  optionalConnections: Array<{label: string; description: string}>;
}

/**
 * Patch event for an in-flight proposal — emitted by `update_plan` to
 * mutate an existing `ProposalBlock` matched on `proposalId`. The widget
 * reducer applies the patch in place; the proposal card never duplicates.
 */
export interface UpdatePlanBlock {
  type: 'update_plan';
  proposalId: string;
  /** Fields to merge into the matched proposal. Unspecified fields are unchanged. */
  patch: Partial<Omit<ProposalBlock, 'type' | 'proposalId'>>;
}

/**
 * Discriminated union of all inline content blocks. Add new block types as
 * additional members — never change or remove existing ones (external
 * renderers depend on the shape).
 */
export type Block =
  | TextBlock
  | AskChoiceBlock
  | AgentCardPreviewBlock
  | ConnectionPanelBlock
  | ProposalBlock
  | UpdatePlanBlock;

/** Type-level helper: extract a specific block by its `type` discriminator. */
export type BlockOfType<T extends Block['type']> = Extract<Block, {type: T}>;
