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

/** Mirrored from runtime/src/types.ts — discriminated union for structured tool result content. */
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
  | AskUserBlock;

// ---------------------------------------------------------------------------
// Widget configuration
// ---------------------------------------------------------------------------

export interface ChatUser {
  id: string;
}

export interface ChatTheme {
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
  /** Return a Bearer token (API key or JWT) for authenticated requests. */
  getToken?: () => string | null | undefined;
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
