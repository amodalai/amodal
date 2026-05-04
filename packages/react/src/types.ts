/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type * as React from 'react';

// ---------------------------------------------------------------------------
// SSE event types — mirrored from runtime/src/types.ts for browser use
// (no @amodalai/core dependency)
// ---------------------------------------------------------------------------

export type SSEEventType =
  | 'init'
  | 'text_delta'
  | 'tool_call_start'
  | 'tool_call_result'
  | 'subagent_event'
  | 'skill_activated'
  | 'widget'
  | 'kb_proposal'
  | 'credential_saved'
  | 'approved'
  | 'ask_user'
  | 'ask_choice'
  | 'show_preview'
  | 'connection_panel'
  | 'plan_summary'
  | 'explore_start'
  | 'explore_end'
  | 'plan_mode'
  | 'field_scrub'
  | 'confirmation_required'
  | 'tool_log'
  | 'tool_label_update'
  | 'warning'
  | 'error'
  | 'done';

export interface SSEInitEvent {
  type: 'init';
  session_id: string;
  timestamp: string;
}

export interface SSETextDeltaEvent {
  type: 'text_delta';
  content: string;
  timestamp: string;
}

export interface SSEToolCallStartEvent {
  type: 'tool_call_start';
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  /** Resolved present-participle label rendered while running. */
  running_label?: string;
  /** Resolved past-tense label rendered after success. */
  completed_label?: string;
  timestamp: string;
}

/**
 * Structured tool result content blocks.
 * Canonical definitions are in @amodalai/types (sse-types.ts).
 * Mirrored here because @amodalai/react has no dependency on @amodalai/types.
 */
export interface SSEToolResultTextBlock {
  type: 'text';
  text: string;
}

export interface SSEToolResultImageBlock {
  type: 'image';
  mimeType: string;
  data: string;
  isUrl?: boolean;
}

export type SSEToolResultContentBlock = SSEToolResultTextBlock | SSEToolResultImageBlock;

export interface SSEToolCallResultEvent {
  type: 'tool_call_result';
  tool_id: string;
  status: 'success' | 'error';
  /** Plain text result. */
  result?: unknown;
  /** Structured content blocks (text + images). When present, supersedes `result`. */
  content?: SSEToolResultContentBlock[];
  parameters?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
  timestamp: string;
}

export interface SSESubagentEvent {
  type: 'subagent_event';
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

export interface SSESkillActivatedEvent {
  type: 'skill_activated';
  skill: string;
  timestamp: string;
}

export interface SSEWidgetEvent {
  type: 'widget';
  widget_type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SSEKBProposalEvent {
  type: 'kb_proposal';
  proposal_id?: string;
  scope: 'org' | 'segment';
  title: string;
  reasoning: string;
  status?: string;
  timestamp: string;
}

export interface SSECredentialSavedEvent {
  type: 'credential_saved';
  connection_name: string;
  timestamp: string;
}

export interface SSEApprovedEvent {
  type: 'approved';
  resource_type: string;
  preview_id: string;
  timestamp: string;
}

export interface SSEAskUserEvent {
  type: 'ask_user';
  ask_id: string;
  questions: AskUserQuestion[];
  timestamp: string;
}

/**
 * Single- or multi-select chat-inline question rendered as a button row.
 * Mirrored from @amodalai/types — see SSEAskChoiceEvent for full docs.
 */
export interface SSEAskChoiceEvent {
  type: 'ask_choice';
  ask_id: string;
  question: string;
  options: AskChoiceOption[];
  multi?: boolean;
  timestamp: string;
}

export interface AskChoiceOption {
  label: string;
  value: string;
  /**
   * Optional one-line description shown beneath the label. When any
   * option in a `multi: true` block has a description, the card
   * renders as a checkbox list (used for optional-connection batches).
   */
  description?: string;
}

/**
 * Inline preview card emitted by the admin agent's `show_preview` tool to
 * surface a template's curated card snippet inside the chat stream.
 * Mirrored from @amodalai/types.
 */
export interface SSEShowPreviewEvent {
  type: 'show_preview';
  card: AgentCardInline;
  timestamp: string;
}

/**
 * Inline connection panel emitted by `present_connection` (Phase
 * H.1). Auth-agnostic — the modal behind the panel handles dispatch.
 * Mirrored from @amodalai/types — see SSEConnectionPanelEvent.
 */
export interface SSEConnectionPanelEvent {
  type: 'connection_panel';
  panel_id: string;
  package_name: string;
  display_name: string;
  description: string;
  skippable: boolean;
  timestamp: string;
}

/**
 * Plan summary card emitted by `load_template_plan` after the
 * SetupPlan composes from the installed template. Read-only —
 * surfaces required + optional connections + config questions so
 * the user sees what got loaded inline. Mirrored from @amodalai/types.
 */
export interface SSEPlanSummaryEvent {
  type: 'plan_summary';
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

/**
 * One slot label + description shown on the Proposal card. Skill /
 * connection display names only — the proposal tool never quotes
 * raw npm package names.
 */
export interface ProposalEntry {
  label: string;
  description: string;
}

/**
 * Plan proposal card emitted on Path B (custom description). The user
 * sees the inferred set of skills + connections with `Looks right →`
 * and `Adjust` buttons. Mirrored from @amodalai/types.
 */
export interface SSEProposalEvent {
  type: 'proposal';
  proposal_id: string;
  summary: string;
  skills: ProposalEntry[];
  required_connections: ProposalEntry[];
  optional_connections: ProposalEntry[];
  timestamp: string;
}

/**
 * Patch event for an in-flight proposal. Matched by `proposal_id`
 * to mutate the existing card in place. Each field is optional;
 * unspecified fields preserve the current card's values.
 */
export interface SSEUpdatePlanEvent {
  type: 'update_plan';
  proposal_id: string;
  summary?: string;
  skills?: ProposalEntry[];
  required_connections?: ProposalEntry[];
  optional_connections?: ProposalEntry[];
  timestamp: string;
}

/**
 * Setup cancelled — Phase E.10. The setup_state row has been deleted;
 * the chat surface flips back to the picker. `reason` is opaque
 * human-readable text for an optional acknowledgement message.
 */
export interface SSESetupCancelledEvent {
  type: 'setup_cancelled';
  reason?: string;
  timestamp: string;
}

/**
 * Setup committed — emitted by request_complete_setup /
 * force_complete_setup once amodal.json is on disk and
 * setup_state.completedAt is set. Studio's AdminChat catches this
 * and reloads `/` to flip from CreateFlowPage to OverviewPage.
 */
export interface SSESetupCompletedEvent {
  type: 'setup_completed';
  completed_at: string;
  timestamp: string;
}

/** Mirrored from @amodalai/types AgentCard — see card-types.ts. */
export interface AgentCardInline {
  title: string;
  tagline: string;
  platforms: string[];
  thumbnailConversation: AgentCardInlineTurn[];
}

export interface AgentCardInlineTurn {
  role: 'user' | 'agent';
  content: string;
}

export interface SSEExploreStartEvent {
  type: 'explore_start';
  query: string;
  timestamp: string;
}

export interface SSEExploreEndEvent {
  type: 'explore_end';
  summary: string;
  tokens_used: number;
  timestamp: string;
}

export interface SSEPlanModeEvent {
  type: 'plan_mode';
  action: 'enter' | 'approve' | 'exit';
  plan?: string;
  timestamp: string;
}

export interface SSEFieldScrubEvent {
  type: 'field_scrub';
  connection: string;
  endpoint: string;
  stripped_count: number;
  timestamp: string;
}

export interface SSEConfirmationRequiredEvent {
  type: 'confirmation_required';
  endpoint: string;
  method: string;
  reason: string;
  escalated: boolean;
  params?: Record<string, unknown>;
  connection_name?: string;
  correlation_id?: string;
  timestamp: string;
}

export interface SSEToolLogEvent {
  type: 'tool_log';
  tool_name: string;
  message: string;
  timestamp: string;
}

/** Live label update emitted by a tool via `ctx.setLabel(...)`. */
export interface SSEToolLabelUpdateEvent {
  type: 'tool_label_update';
  tool_id: string;
  running_label?: string;
  completed_label?: string;
  timestamp: string;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
  timestamp: string;
}

export interface SSEDoneEvent {
  type: 'done';
  timestamp: string;
  usage?: {input_tokens: number; output_tokens: number};
}

export interface SSEWarningEvent {
  type: 'warning';
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
  | SSEWarningEvent
  | SSEErrorEvent
  | SSEDoneEvent;

// ---------------------------------------------------------------------------
// Ask user types
// ---------------------------------------------------------------------------

export interface AskUserQuestion {
  question: string;
  header: string;
  type: 'choice' | 'text' | 'yesno';
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
  placeholder?: string;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Chat message types
// ---------------------------------------------------------------------------

export type ToolCallStatus = 'running' | 'success' | 'error';

export interface SubagentEventInfo {
  agentName: string;
  eventType: 'tool_call_start' | 'tool_call_end' | 'thought' | 'error' | 'complete';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: string;
  text?: string;
  error?: string;
  timestamp: string;
}

export interface ToolCallInfo {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  duration_ms?: number;
  error?: string;
  subagentEvents?: SubagentEventInfo[];
  /** Ephemeral progress message from the tool executor (via ctx.log). */
  logMessage?: string;
  /**
   * Resolved present-participle label rendered while the tool is
   * running. Comes from the runtime's tool definition, with
   * `{{paramName}}` placeholders pre-substituted server-side.
   */
  runningLabel?: string;
  /**
   * Resolved past-tense label rendered after a successful run. Same
   * substitution as `runningLabel`. The widget swaps to this purely
   * based on `status`.
   */
  completedLabel?: string;
}

export interface ConfirmationInfo {
  endpoint: string;
  method: string;
  reason: string;
  escalated: boolean;
  params?: Record<string, unknown>;
  connectionName?: string;
  correlationId?: string;
  status: 'pending' | 'approved' | 'denied';
}

export interface KBProposalInfo {
  scope: 'org' | 'segment';
  title: string;
  reasoning: string;
}

export interface WidgetInfo {
  widgetType: string;
  data: Record<string, unknown>;
}

export type AskUserStatus = 'pending' | 'submitted';

export interface AskUserBlock {
  type: 'ask_user';
  askId: string;
  questions: AskUserQuestion[];
  status: AskUserStatus;
  answers?: Record<string, string>;
}

/**
 * Inline button row asking the user to pick one (or several) of a small set.
 * Status mirrors AskUserBlock — once the user clicks, we lock the buttons
 * to prevent double-submit and show the chosen value(s) as a summary.
 */
export interface AskChoiceBlock {
  type: 'ask_choice';
  askId: string;
  question: string;
  options: AskChoiceOption[];
  multi: boolean;
  status: AskUserStatus;
  /** Selected value(s) after the user picks. Single-select stores one entry. */
  answer?: string[];
}

/** Inline template-card preview surfaced by the `show_preview` tool. */
export interface ShowPreviewBlock {
  type: 'show_preview';
  card: AgentCardInline;
}

/**
 * Plan summary surfaced by the `load_template_plan` tool. Read-only.
 * Renders required + optional connection slots and config questions
 * so the user can verify the right template loaded. No interaction
 * affordances — just structured content.
 */
export interface PlanSummaryBlock {
  type: 'plan_summary';
  templateTitle: string;
  requiredSlots: Array<{
    label: string;
    description: string;
    options: Array<{displayName: string; packageName: string}>;
  }>;
  optionalSlots: Array<{
    label: string;
    description: string;
    options: Array<{displayName: string; packageName: string}>;
  }>;
  configQuestions: Array<{key: string; question: string}>;
  completionSuggestions: string[];
}

/**
 * Inline connection panel surfaced by the `present_connection` tool
 * (Phase H.1). Auth-agnostic — Studio supplies the renderer via
 * `inlineBlockRenderers` (Phase H.2). The widget itself doesn't
 * render this block natively; it falls through to the registry or a
 * placeholder.
 *
 * `state` is a cache the renderer last drew. Studio overwrites it
 * via reconciliation against real env-var status on every chat
 * mount (Phase H.10), so it is never trusted blind. Only
 * `userSkipped` survives reload.
 */
export interface ConnectionPanelBlock {
  type: 'connection_panel';
  panelId: string;
  packageName: string;
  displayName: string;
  description: string;
  skippable: boolean;
  state: 'idle' | 'success' | 'skipped' | 'error';
  /** Persisted hint that the user clicked Later. Only field that survives reload. */
  userSkipped?: boolean;
  /** Optional inline data point shown beside the success state. */
  successDetail?: string;
  /** Optional error message shown beneath the panel in the error state. */
  errorMessage?: string;
}

/**
 * Plan proposal card surfaced by the `propose_plan` tool (Phase D —
 * Path B custom-description flow). Mutated in place by subsequent
 * `update_plan` events keyed off `proposalId`, never duplicated.
 *
 * `status` mirrors AskUserBlock — once the user clicks Looks right
 * or Adjust, we lock the buttons and show the chosen action as a
 * summary so the conversation history reads cleanly.
 */
export interface ProposalBlock {
  type: 'proposal';
  proposalId: string;
  summary: string;
  skills: ProposalEntry[];
  requiredConnections: ProposalEntry[];
  optionalConnections: ProposalEntry[];
  status: AskUserStatus;
  /** 'confirm' or 'adjust', set once the user clicks. */
  answer?: 'confirm' | 'adjust';
}

export interface UserMessage {
  type: 'user';
  id: string;
  text: string;
  /** Data URIs for pasted/uploaded images */
  images?: string[];
  timestamp: string;
}

export interface AssistantTextMessage {
  type: 'assistant_text';
  id: string;
  text: string;
  toolCalls: ToolCallInfo[];
  confirmations: ConfirmationInfo[];
  skillActivations: string[];
  kbProposals: KBProposalInfo[];
  widgets: WidgetInfo[];
  contentBlocks: ContentBlock[];
  timestamp: string;
  /** Per-turn token usage (populated when the turn's done event arrives). */
  usage?: {inputTokens: number; outputTokens: number};
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  message: string;
  timestamp: string;
}

export type ChatMessage = UserMessage | AssistantTextMessage | ErrorMessage;

/**
 * Props passed to a renderer registered via `inlineBlockRenderers`
 * on `<ChatWidget>` (Phase H.2). Studio supplies its own renderer
 * for `connection_panel` so the widget itself stays auth-agnostic
 * (and stays free of `/api/connections-status`, modal-stack, and
 * env-var-inspection plumbing).
 *
 * - `block` — the typed ContentBlock entry to render.
 * - `dispatch` — reducer dispatch handle, scoped to actions the
 *   renderer should ever fire (today: `PANEL_UPDATE`).
 * - `postUserMessage` — post a user turn into the conversation,
 *   same as if the user had typed it. Used by Skip / Configure-success
 *   to inject `Skip {displayName} for now` / `Configured {displayName}`.
 */
export interface BlockRendererProps<TBlock extends ContentBlock = ContentBlock> {
  block: TBlock;
  dispatch: React.Dispatch<ChatAction>;
  postUserMessage: (text: string) => void;
}

/**
 * Optional prop on `<ChatWidget>` (Phase H.2). Each entry maps a
 * block type to a Studio-supplied renderer. The widget falls back to
 * the registry only for block types it doesn't render natively
 * (`connection_panel` is the first opt-in; future Studio-only blocks
 * can register similarly). Native block types (text, ask_choice,
 * proposal, etc.) cannot be overridden — that's a non-goal of the
 * extension point.
 */
export type InlineBlockRendererRegistry = Partial<{
  [K in ContentBlock['type']]: React.ComponentType<
    BlockRendererProps<Extract<ContentBlock, {type: K}>>
  >;
}>;

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'widget'; widgetType: string; data: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallInfo[] }
  | { type: 'confirmation'; confirmation: ConfirmationInfo }
  | AskUserBlock
  | AskChoiceBlock
  | ShowPreviewBlock
  | ConnectionPanelBlock
  | PlanSummaryBlock
  | ProposalBlock;

// ---------------------------------------------------------------------------
// Widget configuration
// ---------------------------------------------------------------------------

export interface ChatUser {
  id: string;
}

export interface ChatTheme {
  /** Color mode. 'auto' follows prefers-color-scheme and .dark ancestor. Default: 'auto'. */
  mode?: 'light' | 'dark' | 'auto';
  primaryColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  borderRadius?: string;
  userBubbleColor?: string;
  agentBubbleColor?: string;
  toolCallColor?: string;
  headerText?: string;
  placeholder?: string;
  emptyStateText?: string;
  /** Show full tool call details (params, results, timing). Default: false. */
  verboseTools?: boolean;
}

export type WidgetPosition = 'right' | 'bottom' | 'floating' | 'inline';

export interface WidgetConfig {
  serverUrl: string;
  user: ChatUser;
  /** Return a Bearer token (API key or JWT) for authenticated requests. May be async to support token refresh. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  theme?: ChatTheme;
  position?: WidgetPosition;
  defaultOpen?: boolean;
  onToolCall?: (call: ToolCallInfo) => void;
  onKBProposal?: (proposal: KBProposalInfo) => void;
  /** Callback for all widget events (agent-driven + interaction). */
  onEvent?: (event: import('./events/types').WidgetEvent) => void;
  /** Custom entity extractors. If provided, replaces the default extractor. */
  entityExtractors?: Array<import('./events/types').EntityExtractor>;
  /** Enable session history drawer. */
  historyEnabled?: boolean;
  /** Show the message input bar. Defaults to true. */
  showInput?: boolean;
  /** Session type — controls which skills, tools, KB docs load into this session. */
  sessionType?: string;
  /** Specific deployment ID to load instead of the active deployment. */
  deployId?: string;
  /** Auto-send this message when the widget mounts. Sent exactly once. */
  initialMessage?: string;
  /** Load an existing session on mount (read-only history view). Takes precedence over initialMessage. */
  resumeSessionId?: string;
  /** Scope ID for multi-tenant session isolation. Scopes sessions, memory, and stores per value. */
  scopeId?: string;
  /** Context key-value pairs injected into connection API calls via contextInjection. */
  scopeContext?: Record<string, string>;
  /** Called when the SSE stream ends (agent finishes responding). */
  onStreamEnd?: () => void;
  /** Called when a session ID is received from the server (first stream init). */
  onSessionCreated?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Chat state
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  error: string | null;
  activeToolCalls: ToolCallInfo[];
  /** True when viewing a loaded historical session (read-only) */
  isHistorical: boolean;
  /** Cumulative token usage across all turns in this session */
  usage: {inputTokens: number; outputTokens: number};
}

export type ChatAction =
  | { type: 'SEND_MESSAGE'; text: string; images?: string[] }
  | { type: 'STREAM_INIT'; sessionId: string }
  | { type: 'STREAM_TEXT_DELTA'; content: string }
  | { type: 'STREAM_TOOL_CALL_START'; toolId: string; toolName: string; parameters: Record<string, unknown>; runningLabel?: string; completedLabel?: string }
  | { type: 'STREAM_TOOL_CALL_RESULT'; toolId: string; status: 'success' | 'error'; result?: unknown; parameters?: Record<string, unknown>; duration_ms?: number; error?: string }
  | { type: 'STREAM_SUBAGENT_EVENT'; parentToolId: string; event: SubagentEventInfo }
  | { type: 'STREAM_SKILL_ACTIVATED'; skill: string }
  | { type: 'STREAM_KB_PROPOSAL'; scope: 'org' | 'segment'; title: string; reasoning: string }
  | { type: 'STREAM_WIDGET'; widgetType: string; data: Record<string, unknown> }
  | { type: 'STREAM_CREDENTIAL_SAVED'; connectionName: string }
  | { type: 'STREAM_APPROVED'; resourceType: string; previewId: string }
  | { type: 'STREAM_ASK_USER'; askId: string; questions: AskUserQuestion[] }
  | { type: 'ASK_USER_SUBMITTED'; askId: string; answers: Record<string, string> }
  | { type: 'STREAM_ASK_CHOICE'; askId: string; question: string; options: AskChoiceOption[]; multi: boolean }
  | { type: 'ASK_CHOICE_SUBMITTED'; askId: string; values: string[] }
  | { type: 'STREAM_SHOW_PREVIEW'; card: AgentCardInline }
  | {
      type: 'STREAM_CONNECTION_PANEL';
      panelId: string;
      packageName: string;
      displayName: string;
      description: string;
      skippable: boolean;
    }
  | {
      type: 'PANEL_UPDATE';
      panelId: string;
      patch: Partial<Pick<ConnectionPanelBlock, 'state' | 'userSkipped' | 'successDetail' | 'errorMessage'>>;
    }
  | {
      type: 'STREAM_PLAN_SUMMARY';
      templateTitle: string;
      requiredSlots: PlanSummaryBlock['requiredSlots'];
      optionalSlots: PlanSummaryBlock['optionalSlots'];
      configQuestions: PlanSummaryBlock['configQuestions'];
      completionSuggestions: string[];
    }
  | {
      type: 'STREAM_PROPOSAL';
      proposalId: string;
      summary: string;
      skills: ProposalEntry[];
      requiredConnections: ProposalEntry[];
      optionalConnections: ProposalEntry[];
    }
  | {
      type: 'STREAM_UPDATE_PLAN';
      proposalId: string;
      summary?: string;
      skills?: ProposalEntry[];
      requiredConnections?: ProposalEntry[];
      optionalConnections?: ProposalEntry[];
    }
  | { type: 'PROPOSAL_SUBMITTED'; proposalId: string; answer: 'confirm' | 'adjust' }
  | { type: 'STREAM_CONFIRMATION_REQUIRED'; confirmation: ConfirmationInfo }
  | { type: 'CONFIRMATION_RESPONDED'; correlationId: string; approved: boolean }
  | { type: 'STREAM_ERROR'; message: string }
  | { type: 'STREAM_TOOL_LOG'; toolName: string; message: string }
  | { type: 'STREAM_TOOL_LABEL_UPDATE'; toolId: string; runningLabel?: string; completedLabel?: string }
  | { type: 'STREAM_DONE'; usage?: {inputTokens: number; outputTokens: number} }
  | { type: 'LOAD_HISTORY'; sessionId: string; messages: ChatMessage[] }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type TaskStatusValue = 'running' | 'completed' | 'error';

export interface TaskStatus {
  task_id: string;
  status: TaskStatusValue;
  event_count: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Brief / Insight / Query result types
// ---------------------------------------------------------------------------

export interface BriefResult {
  text: string;
  toolCalls: ToolCallInfo[];
}

export interface InsightResult {
  status: 'idle' | 'loading' | 'done' | 'error';
  summary: string;
  details: string;
  toolCalls: ToolCallInfo[];
}

export interface QueryResult<T = unknown> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Store types — mirrored from core for browser use
// ---------------------------------------------------------------------------

export interface StoreFieldDefinitionInfo {
  type: string;
  nullable?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  item?: StoreFieldDefinitionInfo;
  fields?: Record<string, StoreFieldDefinitionInfo>;
  store?: string;
}

export interface StoreEntityInfo {
  name: string;
  key: string;
  schema: Record<string, StoreFieldDefinitionInfo>;
}

export interface StoreDefinitionInfo {
  name: string;
  entity: StoreEntityInfo;
  ttl?: number | { default: number; override?: Array<{ condition: string; ttl: number }> };
  trace?: boolean;
  history?: { versions: number };
  documentCount: number;
}

export interface StoreDocumentMeta {
  computedAt: string;
  ttl?: number;
  stale: boolean;
  automationId?: string;
  skillId?: string;
  modelUsed?: string;
  tokenCost?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  trace?: string;
}

export interface StoreDocument {
  key: string;
  appId: string;
  store: string;
  version: number;
  payload: Record<string, unknown>;
  meta: StoreDocumentMeta;
}

export interface StoreListResult {
  documents: StoreDocument[];
  total: number;
  hasMore: boolean;
}

export interface StoreDocumentResult {
  document: StoreDocument | null;
  history: StoreDocument[];
}
