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

export interface SSEToolCallResultEvent {
  type: 'tool_call_result';
  tool_id: string;
  status: 'success' | 'error';
  result?: string;
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
  skill_name: string;
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
  proposal_id: string;
  scope: string;
  title: string;
  reasoning: string;
  status: string;
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

export interface SSEErrorEvent {
  type: 'error';
  message: string;
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
  result?: string;
  duration_ms?: number;
  error?: string;
  subagentEvents?: SubagentEventInfo[];
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
  confirmations: ConfirmationInfo[];
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

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'widget'; widgetType: string; data: Record<string, unknown> }
  | { type: 'tool_calls'; calls: ToolCallInfo[] }
  | { type: 'confirmation'; confirmation: ConfirmationInfo };

// ---------------------------------------------------------------------------
// Chat state
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  error: string | null;
  activeToolCalls: ToolCallInfo[];
}

export type ChatAction =
  | { type: 'SEND_MESSAGE'; text: string }
  | { type: 'STREAM_INIT'; sessionId: string }
  | { type: 'STREAM_TEXT_DELTA'; content: string }
  | { type: 'STREAM_TOOL_CALL_START'; toolId: string; toolName: string; parameters: Record<string, unknown> }
  | { type: 'STREAM_TOOL_CALL_RESULT'; toolId: string; status: 'success' | 'error'; result?: string; duration_ms?: number; error?: string }
  | { type: 'STREAM_SUBAGENT_EVENT'; parentToolId: string; event: SubagentEventInfo }
  | { type: 'STREAM_WIDGET'; widgetType: string; data: Record<string, unknown> }
  | { type: 'STREAM_CONFIRMATION_REQUIRED'; confirmation: ConfirmationInfo }
  | { type: 'CONFIRMATION_RESPONDED'; correlationId: string; approved: boolean }
  | { type: 'STREAM_ERROR'; message: string }
  | { type: 'STREAM_DONE' }
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
  tenantId: string;
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
