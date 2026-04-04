/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 3.1 — State Machine Types
 *
 * Defines the discriminated union for agent states, the context
 * passed through the loop, and the transition result shape.
 */

import type {ModelMessage} from 'ai';
import type {LLMProvider, StreamTextResult, TokenUsage} from '../providers/types.js';
import type {ToolRegistry, ToolContext} from '../tools/types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import type {SSEEvent} from '../types.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Tool call / result (internal to the loop)
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  toolName: string;
  status: 'success' | 'error';
  content: string;
}

// ---------------------------------------------------------------------------
// Done reason
// ---------------------------------------------------------------------------

export type DoneReason =
  | 'model_stop'
  | 'max_turns'
  | 'user_abort'
  | 'error'
  | 'budget_exceeded'
  | 'loop_detected';

// ---------------------------------------------------------------------------
// Agent state (discriminated union)
// ---------------------------------------------------------------------------

export type AgentState =
  | ThinkingState
  | StreamingState
  | ExecutingState
  | ConfirmingState
  | CompactingState
  | DispatchingState
  | DoneState;

export interface ThinkingState {
  type: 'thinking';
  messages: ModelMessage[];
}

export interface StreamingState {
  type: 'streaming';
  stream: StreamTextResult;
  pendingToolCalls: ToolCall[];
}

export interface ExecutingState {
  type: 'executing';
  queue: ToolCall[];
  current: ToolCall;
  results: ToolResult[];
}

export interface ConfirmingState {
  type: 'confirming';
  call: ToolCall;
  remainingQueue: ToolCall[];
}

export interface CompactingState {
  type: 'compacting';
  messages: ModelMessage[];
}

export interface DispatchingState {
  type: 'dispatching';
  task: DispatchConfig;
  parentMessages: ModelMessage[];
}

export interface DoneState {
  type: 'done';
  usage: TokenUsage;
  reason: DoneReason;
}

// ---------------------------------------------------------------------------
// Dispatch config (placeholder for sub-agent dispatch)
// ---------------------------------------------------------------------------

export interface DispatchConfig {
  agentName: string;
  toolSubset: string[];
  prompt: string;
}

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

export interface TransitionResult {
  next: AgentState;
  effects: SSEEvent[];
}

// ---------------------------------------------------------------------------
// Agent context (threaded through the loop)
// ---------------------------------------------------------------------------

/** Configuration knobs for the agent loop. */
export interface AgentLoopConfig {
  /** Max tool result size before snipping (chars). Default 50_000. */
  maxResultSize: number;
  /** Token ratio threshold for compaction. Default 0.8. */
  compactThreshold: number;
  /** Number of recent tool results to keep full. Default 5. */
  keepRecentResults: number;
  /** Number of old results before clearing. Default 15. */
  clearThreshold: number;
  /** Max loop iterations before stopping. Default 8. */
  maxLoopIterations: number;
  /** Max output tokens per LLM call. */
  maxOutputTokens: number;
  /** Timeout for individual tool execution in milliseconds. Default 30_000. */
  toolTimeoutMs: number;
  /** Timeout for user confirmation in milliseconds. Default 300_000 (5 minutes). */
  confirmationTimeoutMs: number;
  /** Hard truncation limit for tool results (chars) before Phase 3.3 snipping. Default 100_000. */
  hardResultTruncation: number;
}

export const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
  maxResultSize: 50_000,
  compactThreshold: 0.8,
  keepRecentResults: 5,
  clearThreshold: 15,
  maxLoopIterations: 8,
  maxOutputTokens: 16_384,
  toolTimeoutMs: 30_000,
  confirmationTimeoutMs: 300_000,
  hardResultTruncation: 100_000,
};

export interface AgentContext {
  /** LLM provider for streamText/generateText calls */
  provider: LLMProvider;

  /** Tool registry holding all available tools */
  toolRegistry: ToolRegistry;

  /** Permission checker for tool execution */
  permissionChecker: PermissionChecker;

  /** Logger scoped to this session */
  logger: Logger;

  /** Abort signal for the session/request */
  signal: AbortSignal;

  /** Session ID for correlation */
  sessionId: string;

  /** Tenant ID for multi-tenant isolation */
  tenantId: string;

  /** Current user info */
  user: {roles: string[]; [key: string]: unknown};

  /** System prompt compiled from skills, knowledge, connections, etc. */
  systemPrompt: string;

  /** Mutable: current conversation messages */
  messages: ModelMessage[];

  /** Mutable: accumulated token usage */
  usage: TokenUsage;

  /** Mutable: turn counter (incremented in THINKING) */
  turnCount: number;

  /** Max turns before stopping */
  maxTurns: number;

  /** Max context tokens (provider's limit) */
  maxContextTokens: number;

  /** Loop config */
  config: AgentLoopConfig;

  /** Cache for pre-executed read-only tool results (populated during STREAMING) */
  preExecutionCache: Map<string, Promise<unknown>>;

  /**
   * Wait for user confirmation on a tool call.
   * Resolves to true (approved) or false (denied).
   * Implemented by the transport layer (HTTP SSE, WebSocket, etc.).
   */
  waitForConfirmation: (callId: string) => Promise<boolean>;

  /**
   * Build a ToolContext for tool execution from the AgentContext.
   * Wires high-level interfaces (store, request, env) to low-level components.
   */
  buildToolContext: (callId: string) => ToolContext;
}

// ---------------------------------------------------------------------------
// runAgent options (public API)
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  /** Initial messages (user message + conversation history) */
  messages: ModelMessage[];
  /** Fully initialized agent context */
  context: AgentContext;
}
