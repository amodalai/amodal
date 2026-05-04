/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import type { AutomationDefinition } from '@amodalai/core';
import type { SSEToolResultContentBlock } from '@amodalai/types';
export type { SSEToolResultTextBlock, SSEToolResultImageBlock, SSEToolResultContentBlock } from '@amodalai/types';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const ImageAttachmentSchema = z.object({
  /** IANA media type */
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  /** Base64-encoded image data (no data URI prefix). Max ~5MB decoded. */
  data: z.string().min(1).max(7_000_000),
});

export const ChatRequestSchema = z.object({
  /** The user message to send to the agent */
  message: z.string().min(1),
  /** Optional image attachments */
  images: z.array(ImageAttachmentSchema).max(5).optional(),
  /** Optional session ID to continue a conversation */
  session_id: z.string().optional(),
  /** Optional session type — controls which skills, tools, KB docs load */
  session_type: z.enum(['chat', 'admin', 'automation']).optional(),
  /** Optional deployment ID — load a specific snapshot instead of the active one */
  deploy_id: z.string().optional(),
  /**
   * Optional session-wide **token** budget cap (not dollars; cost varies
   * by model). When cumulative usage reaches this value the loop
   * terminates with `reason: 'budget_exceeded'`. Absent = no cap.
   *
   * This is a **soft ceiling** — the check runs after each turn, so a
   * single in-flight turn can overshoot by up to `maxOutputTokens` +
   * tool result sizes. Size the cap ~20% below your hard limit.
   *
   * Distinct from the LLM-API `max_tokens` (per-call output cap) —
   * this is a session-wide cumulative total across all turns.
   */
  max_session_tokens: z.number().int().positive().optional(),
  /** Model override — pin this session to a specific provider/model */
  model: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }).optional(),
  /** Optional scope ID for per-user session isolation */
  scope_id: z.string().optional(),
  /** Optional context key-value pairs to associate with the scope */
  context: z.record(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const WebhookPayloadSchema = z.object({
  /** Optional event data passed to the automation prompt */
  data: z.record(z.unknown()).optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ToolCallSummary {
  tool_name: string;
  tool_id: string;
  /** The arguments passed to the tool call */
  args?: Record<string, unknown>;
  status: 'success' | 'error';
  duration_ms?: number;
  error?: string;
  /** Truncated tool result text for debugging (audit log only) */
  result?: string;
  /** Inner tool calls made by subagents (task agents) */
  inner_tool_calls?: Array<Record<string, unknown>>;
}

export interface ChatResponse {
  session_id: string;
  response: string;
  tool_calls: ToolCallSummary[];
}

export interface AutomationResult {
  automation: string;
  response: string;
  tool_calls: ToolCallSummary[];
  output_sent: boolean;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

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
  CompactionStart = 'compaction_start',
  CompactionEnd = 'compaction_end',
  ToolLog = 'tool_log',
  ToolLabelUpdate = 'tool_label_update',
  Warning = 'warning',
  Error = 'error',
  Done = 'done',
  StartOAuth = 'start_oauth',
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
   * Resolved present-participle label rendered while the tool runs
   * (e.g. "Looking up template 'marketing-digest'"). Comes from the
   * tool definition's `runningLabel` with `{{paramName}}` placeholders
   * substituted against `parameters`.
   */
  running_label?: string;
  /**
   * Resolved past-tense label the widget swaps to once the call
   * completes. Sent on the start event so the UI has both labels in
   * hand and can switch purely on status.
   */
  completed_label?: string;
  timestamp: string;
}

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

export interface SSEWarningEvent {
  type: SSEEventType.Warning;
  message: string;
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

export interface SSEDoneEvent {
  type: SSEEventType.Done;
  timestamp: string;
  /**
   * Why the loop stopped. Consumers use this to distinguish normal
   * termination from enforced caps (budget, turns, loop detection).
   */
  reason?:
    | 'model_stop'
    | 'max_turns'
    | 'user_abort'
    | 'error'
    | 'budget_exceeded'
    | 'loop_detected';
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

/**
 * Single- or multi-select chat-inline question rendered as a button row.
 * Mirrored from @amodalai/types.
 */
export interface SSEAskChoiceEvent {
  type: SSEEventType.AskChoice;
  ask_id: string;
  question: string;
  options: Array<{label: string; value: string}>;
  multi?: boolean;
  timestamp: string;
}

/** Inline template-card preview emitted by the admin agent's `show_preview` tool. */
export interface SSEShowPreviewEvent {
  type: SSEEventType.ShowPreview;
  card: {
    title: string;
    tagline: string;
    platforms: string[];
    thumbnailConversation: Array<{role: 'user' | 'agent'; content: string}>;
  };
  timestamp: string;
}

/**
 * Inline connection panel — Phase H.1. Auth-agnostic; the modal
 * behind the panel handles dispatch.
 */
export interface SSEConnectionPanelEvent {
  type: SSEEventType.ConnectionPanel;
  panel_id: string;
  package_name: string;
  display_name: string;
  description: string;
  skippable: boolean;
  timestamp: string;
}

/** Plan summary card emitted after load_template_plan composes the Plan. Read-only. */
export interface SSEPlanSummaryEvent {
  type: SSEEventType.PlanSummary;
  template_title: string;
  required_slots: Array<{
    label: string;
    description: string;
    options: Array<{display_name: string; package_name: string}>;
  }>;
  optional_slots: Array<{
    label: string;
    description: string;
    options: Array<{display_name: string; package_name: string}>;
  }>;
  config_questions: Array<{key: string; question: string}>;
  completion_suggestions: string[];
  timestamp: string;
}

/** Proposal card emitted by the admin agent's `propose_plan` tool (Phase D). */
export interface SSEProposalEvent {
  type: SSEEventType.Proposal;
  proposal_id: string;
  summary: string;
  skills: Array<{label: string; description: string}>;
  required_connections: Array<{label: string; description: string}>;
  optional_connections: Array<{label: string; description: string}>;
  timestamp: string;
}

/** Patch event for an in-flight proposal (Phase D). Matched by `proposal_id`. */
export interface SSEUpdatePlanEvent {
  type: SSEEventType.UpdatePlan;
  proposal_id: string;
  summary?: string;
  skills?: Array<{label: string; description: string}>;
  required_connections?: Array<{label: string; description: string}>;
  optional_connections?: Array<{label: string; description: string}>;
  timestamp: string;
}

/** Setup cancelled — Phase E.10. The setup_state row has been deleted; Studio flips back to picker. */
export interface SSESetupCancelledEvent {
  type: SSEEventType.SetupCancelled;
  reason?: string;
  timestamp: string;
}

/** Setup committed — emitted by commit_setup (via request/force_complete_setup) so AdminChat can transition deterministically. */
export interface SSESetupCompletedEvent {
  type: SSEEventType.SetupCompleted;
  completed_at: string;
  timestamp: string;
}

export interface SSECompactionStartEvent {
  type: SSEEventType.CompactionStart;
  estimated_tokens: number;
  threshold: number;
  timestamp: string;
}

export interface SSECompactionEndEvent {
  type: SSEEventType.CompactionEnd;
  tokens_before: number;
  tokens_after: number;
  compaction_tokens: number;
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
  | SSEExploreStartEvent
  | SSEExploreEndEvent
  | SSEPlanModeEvent
  | SSEFieldScrubEvent
  | SSEConfirmationRequiredEvent
  | SSEAskChoiceEvent
  | SSEShowPreviewEvent
  | SSEConnectionPanelEvent
  | SSEPlanSummaryEvent
  | SSEProposalEvent
  | SSEUpdatePlanEvent
  | SSESetupCancelledEvent
  | SSESetupCompletedEvent
  | SSECompactionStartEvent
  | SSECompactionEndEvent
  | SSEToolLogEvent
  | SSEToolLabelUpdateEvent
  | SSEWarningEvent
  | SSEErrorEvent
  | SSEDoneEvent
  | SSEStartOAuthEvent;

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
 * widget patches the active tool-call card in place. Either or both
 * fields may be present.
 */
export interface SSEToolLabelUpdateEvent {
  type: SSEEventType.ToolLabelUpdate;
  tool_id: string;
  running_label?: string;
  completed_label?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Inline tool events (emitted via ctx.emit during tool execution)
// ---------------------------------------------------------------------------

export interface SSEAskChoiceEvent {
  type: SSEEventType.AskChoice;
  ask_id: string;
  question: string;
  options: Array<{label: string; value: string}>;
  multi?: boolean;
  timestamp: string;
}

export interface SSEShowPreviewEvent {
  type: SSEEventType.ShowPreview;
  card: {
    title: string;
    tagline: string;
    platforms: string[];
    thumbnailConversation: Array<{role: 'user' | 'agent'; content: string}>;
  };
  timestamp: string;
}

export interface SSEStartOAuthEvent {
  type: SSEEventType.StartOAuth;
  package_name: string;
  display_name?: string;
  description?: string;
  skippable?: boolean;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface ServerConfig {
  /** Port to listen on (default 3000) */
  port: number;
  /** Host to bind to (default '0.0.0.0') */
  host: string;
  /** Session TTL in milliseconds (default 30 minutes) */
  sessionTtlMs: number;
  /** Automation definitions from the version bundle */
  automations: AutomationDefinition[];
  /** Application ID for scoping sessions and stores (default 'local') */
  appId?: string;
  /** Allowed CORS origin(s). Use '*' for any origin, or a specific URL. Defaults to '*'. */
  corsOrigin?: string;
}

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
