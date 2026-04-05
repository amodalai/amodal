/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import type { AutomationDefinition } from '@amodalai/core';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const ChatRequestSchema = z.object({
  /** The user message to send to the agent */
  message: z.string().min(1),
  /** Optional session ID to continue a conversation */
  session_id: z.string().optional(),
  /** Optional role override for this session */
  role: z.string().optional(),
  /** Optional session type — controls which skills, tools, KB docs load */
  session_type: z.enum(['chat', 'admin', 'automation']).optional(),
  /** Optional deployment ID — load a specific snapshot instead of the active one */
  deploy_id: z.string().optional(),
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
  ExploreStart = 'explore_start',
  ExploreEnd = 'explore_end',
  PlanMode = 'plan_mode',
  FieldScrub = 'field_scrub',
  ConfirmationRequired = 'confirmation_required',
  CompactionStart = 'compaction_start',
  CompactionEnd = 'compaction_end',
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

export interface SSEToolCallResultEvent {
  type: SSEEventType.ToolCallResult;
  tool_id: string;
  status: 'success' | 'error';
  result?: string;
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
  | SSECompactionStartEvent
  | SSECompactionEndEvent
  | SSEToolLogEvent
  | SSEErrorEvent
  | SSEDoneEvent;

export interface SSEToolLogEvent {
  type: SSEEventType.ToolLog;
  tool_name: string;
  message: string;
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
