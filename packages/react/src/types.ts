/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

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
  | 'start_oauth'
  | 'explore_start'
  | 'explore_end'
  | 'plan_mode'
  | 'field_scrub'
  | 'confirmation_required'
  | 'tool_log'
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
 * Inline OAuth Connect card emitted by `start_oauth_connection`.
 * Mirrored from @amodalai/types — see SSEStartOAuthEvent for full docs.
 */
export interface SSEStartOAuthEvent {
  type: 'start_oauth';
  package_name: string;
  display_name?: string;
  description?: string;
  skippable?: boolean;
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
  | SSEStartOAuthEvent
  | SSEProposalEvent
  | SSEUpdatePlanEvent
  | SSEExploreStartEvent
  | SSEExploreEndEvent
  | SSEPlanModeEvent
  | SSEFieldScrubEvent
  | SSEConfirmationRequiredEvent
  | SSEToolLogEvent
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

/** Inline OAuth Connect card surfaced by the `start_oauth_connection` tool. */
export interface StartOAuthBlock {
  type: 'start_oauth';
  packageName: string;
  displayName?: string;
  description?: string;
  skippable?: boolean;
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

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'widget'; widgetType: string; data: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallInfo[] }
  | { type: 'confirmation'; confirmation: ConfirmationInfo }
  | AskUserBlock
  | AskChoiceBlock
  | ShowPreviewBlock
  | StartOAuthBlock
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
  | { type: 'STREAM_TOOL_CALL_START'; toolId: string; toolName: string; parameters: Record<string, unknown> }
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
  | { type: 'STREAM_START_OAUTH'; packageName: string; displayName?: string; description?: string; skippable?: boolean }
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
