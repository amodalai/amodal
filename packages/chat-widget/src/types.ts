/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// SSE event types from the API server
// ---------------------------------------------------------------------------

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

export interface SSEToolCallResultEvent {
  type: 'tool_call_result';
  tool_id: string;
  status: 'success' | 'error';
  result?: unknown;
  duration_ms?: number;
  error?: string;
  timestamp: string;
}

export interface SSESkillActivatedEvent {
  type: 'skill_activated';
  skill: string;
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

export interface SSEErrorEvent {
  type: 'error';
  message: string;
  timestamp: string;
}

export interface SSEWidgetEvent {
  type: 'widget';
  widget_type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface SSEDoneEvent {
  type: 'done';
  timestamp: string;
}

export type SSEEvent =
  | SSEInitEvent
  | SSETextDeltaEvent
  | SSEToolCallStartEvent
  | SSEToolCallResultEvent
  | SSESubagentEvent
  | SSESkillActivatedEvent
  | SSEKBProposalEvent
  | SSECredentialSavedEvent
  | SSEApprovedEvent
  | SSEAskUserEvent
  | SSEWidgetEvent
  | SSEErrorEvent
  | SSEDoneEvent;

// ---------------------------------------------------------------------------
// Chat message types (discriminated union per spec)
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
}

export interface UserMessage {
  type: 'user';
  id: string;
  text: string;
  timestamp: string;
}

export interface AssistantTextMessage {
  type: 'assistant_text';
  id: string;
  text: string;
  toolCalls: ToolCallInfo[];
  skillActivations: string[];
  kbProposals: KBProposalInfo[];
  widgets: WidgetInfo[];
  contentBlocks: ContentBlock[];
  timestamp: string;
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  message: string;
  timestamp: string;
}

export type ChatMessage = UserMessage | AssistantTextMessage | ErrorMessage;

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

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'widget'; widgetType: string; data: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallInfo[] }
  | AskUserBlock;

// ---------------------------------------------------------------------------
// Widget configuration
// ---------------------------------------------------------------------------

export interface ChatUser {
  id: string;
  role?: string;
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
// Chat state for the hook
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  error: string | null;
  activeToolCalls: ToolCallInfo[];
  /** True when viewing a loaded historical session (read-only) */
  isHistorical: boolean;
}

export type ChatAction =
  | { type: 'SEND_MESSAGE'; text: string }
  | { type: 'STREAM_INIT'; sessionId: string }
  | { type: 'STREAM_TEXT_DELTA'; content: string }
  | { type: 'STREAM_TOOL_CALL_START'; toolId: string; toolName: string; parameters: Record<string, unknown> }
  | { type: 'STREAM_TOOL_CALL_RESULT'; toolId: string; status: 'success' | 'error'; result?: unknown; duration_ms?: number; error?: string }
  | { type: 'STREAM_SUBAGENT_EVENT'; parentToolId: string; event: SubagentEventInfo }
  | { type: 'STREAM_SKILL_ACTIVATED'; skill: string }
  | { type: 'STREAM_KB_PROPOSAL'; scope: 'org' | 'segment'; title: string; reasoning: string }
  | { type: 'STREAM_WIDGET'; widgetType: string; data: Record<string, unknown> }
  | { type: 'STREAM_CREDENTIAL_SAVED'; connectionName: string }
  | { type: 'STREAM_APPROVED'; resourceType: string; previewId: string }
  | { type: 'STREAM_ASK_USER'; askId: string; questions: AskUserQuestion[] }
  | { type: 'ASK_USER_SUBMITTED'; askId: string; answers: Record<string, string> }
  | { type: 'STREAM_ERROR'; message: string }
  | { type: 'STREAM_DONE' }
  | { type: 'LOAD_HISTORY'; sessionId: string; messages: ChatMessage[] }
  | { type: 'RESET' };
