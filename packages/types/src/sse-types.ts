/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentCard} from './card-types.js';

export enum SSEEventType {
  Init = 'init',
  TextDelta = 'text_delta',
  ToolCallStart = 'tool_call_start',
  ToolCallResult = 'tool_call_result',
  SubagentEvent = 'subagent_event',
  SkillActivated = 'skill_activated',
  Widget = 'widget',
  KBProposal = 'kb_proposal',
  CredentialSaved = 'credential_saved',
  Approved = 'approved',
  AskUser = 'ask_user',
  AskChoice = 'ask_choice',
  ShowPreview = 'show_preview',
  ConnectionPanel = 'connection_panel',
  PlanSummary = 'plan_summary',
  Proposal = 'proposal',
  UpdatePlan = 'update_plan',
  SetupCancelled = 'setup_cancelled',
  SetupCompleted = 'setup_completed',
  ExploreStart = 'explore_start',
  ExploreEnd = 'explore_end',
  PlanMode = 'plan_mode',
  FieldScrub = 'field_scrub',
  ConfirmationRequired = 'confirmation_required',
  ToolLog = 'tool_log',
  ToolLabelUpdate = 'tool_label_update',
  Error = 'error',
  Done = 'done',
}

export interface SSEInitEvent {
  type: SSEEventType.Init;
  session_id: string;
  timestamp: string;
}

export interface SSETextDeltaEvent {
  type: SSEEventType.TextDelta;
  content: string;
  timestamp: string;
}

export interface SSEToolCallStartEvent {
  type: SSEEventType.ToolCallStart;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  /**
   * Resolved present-participle label rendered while the tool is
   * running, e.g. "Looking up template 'marketing-digest'". Comes from
   * the tool definition's `runningLabel` with `{{paramName}}`
   * placeholders substituted against `parameters`. Optional — undefined
   * tools fall back to `tool_name` in the UI.
   */
  running_label?: string;
  /**
   * Resolved past-tense label the UI swaps to once the tool completes.
   * Sent on the start event so the widget has both labels in hand and
   * can switch on status without waiting for a separate result message.
   * Optional — undefined keeps `running_label` after completion.
   */
  completed_label?: string;
  /**
   * Marks the tool call as internal plumbing the user shouldn't see by
   * default. Mirrors the tool definition's `internal` flag — the chat
   * widget hides these calls unless `verboseTools` is enabled.
   */
  internal?: boolean;
  timestamp: string;
}

/** A text block in a structured tool result. */
export interface SSEToolResultTextBlock {
  type: 'text';
  text: string;
}

/** An image block in a structured tool result. */
export interface SSEToolResultImageBlock {
  type: 'image';
  mimeType: string;
  data: string;
  isUrl?: boolean;
}

/** Discriminated union for structured tool result content. */
export type SSEToolResultContentBlock = SSEToolResultTextBlock | SSEToolResultImageBlock;

export interface SSEToolCallResultEvent {
  type: SSEEventType.ToolCallResult;
  tool_id: string;
  status: 'success' | 'error';
  /** Plain text result. */
  result?: string;
  /** Structured content blocks with images. When present, supersedes `result`. */
  content?: SSEToolResultContentBlock[];
  parameters?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
  timestamp: string;
}

export interface SSESubagentEvent {
  type: SSEEventType.SubagentEvent;
  parent_tool_id: string;
  agent_name: string;
  event_type: 'tool_call_start' | 'tool_call_end' | 'thought' | 'error' | 'complete';
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  result?: string;
  text?: string;
  error?: string;
  timestamp: string;
}

export interface SSEErrorEvent {
  type: SSEEventType.Error;
  message: string;
  timestamp: string;
}

export interface SSEWidgetEvent {
  type: SSEEventType.Widget;
  widget_type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SSESkillActivatedEvent {
  type: SSEEventType.SkillActivated;
  skill_name: string;
  timestamp: string;
}

export interface SSEKBProposalEvent {
  type: SSEEventType.KBProposal;
  proposal_id: string;
  scope: string;
  title: string;
  reasoning: string;
  status: string;
  timestamp: string;
}

export interface SSECredentialSavedEvent {
  type: SSEEventType.CredentialSaved;
  connection_name: string;
  timestamp: string;
}

export interface SSEApprovedEvent {
  type: SSEEventType.Approved;
  resource_type: string;
  preview_id: string;
  timestamp: string;
}

export interface SSEAskUserEvent {
  type: SSEEventType.AskUser;
  ask_id: string;
  questions: Array<{
    id: string;
    text: string;
    type?: string;
    options?: Array<{label: string; value: string}>;
  }>;
  timestamp: string;
}

/**
 * Single- or multi-select question rendered inline in chat as a row of
 * buttons. Distinct from `ask_user` which is a free-form Q&A panel — a choice
 * fits the "Which analytics platform do you use? [Google Analytics] [Adobe]
 * [Other]" pattern from the v4 onboarding flow.
 *
 * Studio renders the buttons; clicking one posts the chosen value back as
 * the next user turn (ask_id round-trips so the agent matches reply to ask).
 */
export interface SSEAskChoiceEvent {
  type: SSEEventType.AskChoice;
  ask_id: string;
  question: string;
  options: Array<{label: string; value: string}>;
  /** When true, the user can pick more than one option. */
  multi?: boolean;
  timestamp: string;
}

/**
 * Inline preview card. Used by the admin agent's `show_preview` tool to
 * surface a template's curated card snippet inside the chat stream.
 */
export interface SSEShowPreviewEvent {
  type: SSEEventType.ShowPreview;
  card: AgentCard;
  timestamp: string;
}

/**
 * Plan summary card emitted by the `load_template_plan` custom tool
 * after the SetupPlan is composed from the installed template's
 * `template.json`. Lets the user see a structured view of what got
 * pulled — required + optional connections, config questions —
 * before the agent walks through them. Read-only; no buttons.
 */
export interface SSEPlanSummaryEvent {
  type: SSEEventType.PlanSummary;
  /** Display title — `state.plan.completion.title` or the template package name. */
  template_title: string;
  /** Required connection slots, in author order. */
  required_slots: Array<{
    label: string;
    description: string;
    options: Array<{display_name: string; package_name: string}>;
  }>;
  /** Optional connection slots, in author order. */
  optional_slots: Array<{
    label: string;
    description: string;
    options: Array<{display_name: string; package_name: string}>;
  }>;
  /** Configuration questions the agent will ask during the `configuring` phase. */
  config_questions: Array<{key: string; question: string}>;
  /** Optional "what comes next" suggestions from the Plan's completion block. */
  completion_suggestions: string[];
  timestamp: string;
}

/**
 * Inline connection panel. Emitted by the admin agent's
 * `present_connection` custom tool — Phase H.1. Studio renders a
 * single Configure button regardless of the package's auth type;
 * the modal that opens behind Configure handles dispatch
 * (OAuth-capable / bearer / api-key / basic). The agent never
 * reasons about auth shape.
 *
 * Replaces the legacy `start_oauth` event, which assumed every
 * connection was OAuth-capable and forced the agent to know the
 * difference.
 */
export interface SSEConnectionPanelEvent {
  type: SSEEventType.ConnectionPanel;
  /** Stable id matching subsequent panel updates back to this block. */
  panel_id: string;
  /** npm package providing the connection (e.g. "@amodalai/connection-slack"). */
  package_name: string;
  /** Human-readable name shown on the panel ("Slack"). */
  display_name: string;
  /** Short one-line description ("Where the digest gets posted"). */
  description: string;
  /** When true, the panel renders a Later button so the user can defer. */
  skippable: boolean;
  timestamp: string;
}

/**
 * Plan proposal card emitted on Path B (custom description). The user
 * sees the inferred set of skills + connections + optional connections
 * in plain English with `Looks right →` and `Adjust` buttons. Phase D
 * of the admin-setup build plan.
 *
 * Skill / connection display names are author-readable strings — the
 * tool never emits raw npm package names ("@amodalai/connection-slack").
 * Empty `optional_connections` is fine and renders the section as
 * skipped.
 *
 * `proposal_id` round-trips so subsequent `SSEUpdatePlanEvent` can
 * mutate the same card in place rather than appending a duplicate.
 */
export interface SSEProposalEvent {
  type: SSEEventType.Proposal;
  /** Stable id for matching subsequent update_plan events back to this card. */
  proposal_id: string;
  /** What the agent does, one short paragraph. */
  summary: string;
  /** Skill display names — never raw package names. */
  skills: Array<{label: string; description: string}>;
  /** Required connection slots, by display label ("CRM", "Slack"). */
  required_connections: Array<{label: string; description: string}>;
  /** Optional connection slots, by display label. */
  optional_connections: Array<{label: string; description: string}>;
  timestamp: string;
}

/**
 * Patch event for an in-flight proposal — emitted by `update_plan`
 * during the Adjust conversation. The widget reducer matches on
 * `proposal_id` and mutates the existing `SSEProposalEvent`-derived
 * card in place (so the chat doesn't accumulate duplicate proposals
 * as the user iterates).
 *
 * Each field on the patch is optional; unspecified fields preserve
 * whatever the current proposal carries.
 */
export interface SSEUpdatePlanEvent {
  type: SSEEventType.UpdatePlan;
  /** Must match the `proposal_id` of an existing proposal block. */
  proposal_id: string;
  /** Replace the summary text. */
  summary?: string;
  /** Replace the skill list. */
  skills?: Array<{label: string; description: string}>;
  /** Replace the required connections list. */
  required_connections?: Array<{label: string; description: string}>;
  /** Replace the optional connections list. */
  optional_connections?: Array<{label: string; description: string}>;
  timestamp: string;
}

/**
 * Setup cancelled — Phase E.10. Emitted by the admin agent's
 * `cancel_setup` tool when the user says "actually I want a
 * different template." The setup_state row has been deleted
 * server-side; Studio's CreateFlowPage flips back to picker mode
 * (Phase E.11).
 *
 * `reason` is opaque human-readable text the chat surface can
 * surface as a brief acknowledgement ("No problem — let me take you
 * back to the templates.").
 */
export interface SSESetupCancelledEvent {
  type: SSEEventType.SetupCancelled;
  reason?: string;
  timestamp: string;
}

/**
 * Setup committed — emitted by `commit_setup` (via the
 * request_complete_setup / force_complete_setup tools) once
 * `amodal.json` is on disk and `setup_state.completedAt` is set.
 * Studio's AdminChat catches this and reloads `/` so IndexPage's
 * route guard transitions from CreateFlowPage to OverviewPage
 * deterministically — the polling-based transition (every 2s)
 * works too but this avoids the up-to-2s gap between commit and
 * the first poll that sees both signals settled.
 */
export interface SSESetupCompletedEvent {
  type: SSEEventType.SetupCompleted;
  completed_at: string;
  timestamp: string;
}

export interface SSEDoneEvent {
  type: SSEEventType.Done;
  timestamp: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    cache_creation_tokens?: number;
    total_tokens: number;
  };
}

export interface SSEExploreStartEvent {
  type: SSEEventType.ExploreStart;
  query: string;
  timestamp: string;
}

export interface SSEExploreEndEvent {
  type: SSEEventType.ExploreEnd;
  summary: string;
  tokens_used: number;
  timestamp: string;
}

export interface SSEPlanModeEvent {
  type: SSEEventType.PlanMode;
  action: 'enter' | 'approve' | 'exit';
  plan?: string;
  timestamp: string;
}

export interface SSEFieldScrubEvent {
  type: SSEEventType.FieldScrub;
  connection: string;
  endpoint: string;
  stripped_count: number;
  timestamp: string;
}

export interface SSEConfirmationRequiredEvent {
  type: SSEEventType.ConfirmationRequired;
  endpoint: string;
  method: string;
  reason: string;
  escalated: boolean;
  timestamp: string;
}

export interface SSEToolLogEvent {
  type: SSEEventType.ToolLog;
  tool_name: string;
  message: string;
  timestamp: string;
}

/**
 * Live label update emitted by a tool handler via `ctx.setLabel(...)`.
 * Lets a tool dynamically replace its running / completed phrase as it
 * works ("Cloning…" → "Installing 12 packages" → "Composed plan"). The
 * widget patches the active tool-call card in place. Either field may
 * be present — passing only `running_label` updates the in-flight
 * phrase, only `completed_label` swaps the post-success phrase, both
 * sets both at once.
 */
export interface SSEToolLabelUpdateEvent {
  type: SSEEventType.ToolLabelUpdate;
  tool_id: string;
  running_label?: string;
  completed_label?: string;
  timestamp: string;
}

export type SSEEvent =
  | SSEInitEvent
  | SSETextDeltaEvent
  | SSEToolCallStartEvent
  | SSEToolCallResultEvent
  | SSESubagentEvent
  | SSESkillActivatedEvent
  | SSEWidgetEvent
  | SSEKBProposalEvent
  | SSECredentialSavedEvent
  | SSEApprovedEvent
  | SSEAskUserEvent
  | SSEAskChoiceEvent
  | SSEShowPreviewEvent
  | SSEConnectionPanelEvent
  | SSEPlanSummaryEvent
  | SSEProposalEvent
  | SSEUpdatePlanEvent
  | SSESetupCancelledEvent
  | SSESetupCompletedEvent
  | SSEExploreStartEvent
  | SSEExploreEndEvent
  | SSEPlanModeEvent
  | SSEFieldScrubEvent
  | SSEConfirmationRequiredEvent
  | SSEToolLogEvent
  | SSEToolLabelUpdateEvent
  | SSEErrorEvent
  | SSEDoneEvent;
