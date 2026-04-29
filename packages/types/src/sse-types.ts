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
  StartOAuth = 'start_oauth',
  ExploreStart = 'explore_start',
  ExploreEnd = 'explore_end',
  PlanMode = 'plan_mode',
  FieldScrub = 'field_scrub',
  ConfirmationRequired = 'confirmation_required',
  ToolLog = 'tool_log',
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
 * Inline OAuth Connect button. Emitted by the admin agent's
 * `start_oauth_connection` tool. Studio renders a card with a Connect
 * button (which opens the provider's authorize URL — fetched at
 * click-time from the runtime's `/api/oauth/start?package=<package_name>`
 * endpoint; cloud-studio-app proxies that to platform-api's
 * `/connections/start/<provider>`) plus a "Later" skip option for
 * non-blocking flows.
 */
export interface SSEStartOAuthEvent {
  type: SSEEventType.StartOAuth;
  /** npm package name with the connection (e.g. "@amodalai/connection-slack"). */
  package_name: string;
  /** Optional human-readable label for the button ("Connect Slack"). */
  display_name?: string;
  /** Optional one-line description shown next to the name (e.g. "Website traffic + conversions"). */
  description?: string;
  /** When true, the card shows a Later button so the user can skip. */
  skippable?: boolean;
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
  | SSEStartOAuthEvent
  | SSEExploreStartEvent
  | SSEExploreEndEvent
  | SSEPlanModeEvent
  | SSEFieldScrubEvent
  | SSEConfirmationRequiredEvent
  | SSEToolLogEvent
  | SSEErrorEvent
  | SSEDoneEvent;
