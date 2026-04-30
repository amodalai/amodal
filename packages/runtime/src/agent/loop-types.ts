/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * State Machine Types
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
import type {TurnUsage} from '../session/types.js';

// ---------------------------------------------------------------------------
// Tool call / result (internal to the loop)
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool result content (structured blocks for images, text, etc.)
// ---------------------------------------------------------------------------

/** Max base64 size for a single image in a tool result (1MB). */
export const MAX_IMAGE_BLOCK_SIZE = 1_024 * 1_024;

/** Max total base64 image data across all images in a single tool result (5MB). */
export const MAX_TOTAL_IMAGE_SIZE = 5 * 1_024 * 1_024;

export interface ToolResultTextBlock {
  type: 'text';
  text: string;
}

export interface ToolResultImageBlock {
  type: 'image';
  mimeType: string;
  /** base64-encoded data or a URL (when isUrl is true) */
  data: string;
  isUrl?: boolean;
}

export type ToolResultContentBlock = ToolResultTextBlock | ToolResultImageBlock;

export interface ToolResult {
  callId: string;
  toolName: string;
  status: 'success' | 'error';
  /** Plain string or structured content blocks (when images are present). */
  content: string | ToolResultContentBlock[];
}

/** Convert structured content blocks to a plain string for error messages or LLM context. */
export function contentBlocksToString(blocks: ToolResultContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      return `[image: ${b.mimeType}]`;
    })
    .join('\n');
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
  estimatedTokens: number;
}

export interface DispatchingState {
  type: 'dispatching';
  task: DispatchConfig;
  /** Tool call ID of the dispatch_task call — needed for the tool result message */
  toolCallId: string;
  /** Remaining tool calls in the parent's execution queue */
  queue: ToolCall[];
  /** Results from prior tool calls in this execution round */
  results: ToolResult[];
}

export interface DoneState {
  type: 'done';
  usage: TokenUsage;
  reason: DoneReason;
}

// ---------------------------------------------------------------------------
// Dispatch config (sub-agent dispatch)
// ---------------------------------------------------------------------------

export interface DispatchConfig {
  agentName: string;
  toolSubset: string[];
  prompt: string;
  /** Max turns for child agent (default: 10) */
  maxTurns?: number;
  /** Max context tokens for child agent */
  maxContextTokens?: number;
  /** Timeout in ms for the child agent (default: 60s) */
  timeoutMs?: number;
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
  /** Max tool result size before smart snipping (chars). Default 20_000. */
  maxResultSize: number;
  /** Token ratio threshold for compaction (0-1). Default 0.7. */
  compactThreshold: number;
  /** Number of recent tool results to keep full. Default 5. */
  keepRecentResults: number;
  /** Number of tool results before clearing old ones. Default 15. */
  clearThreshold: number;
  /** Max repeated tool calls before forcing loop_detected. Default 8. */
  maxLoopIterations: number;
  /** Repeated tool call count that triggers a warning injection. Default 3. */
  loopWarningThreshold: number;
  /**
   * Repeated tool call count that escalates: stronger warning + the looping
   * tool is temporarily removed from the tool set passed to the model, so
   * it is forced to try a different approach. Default 5 (between
   * loopWarningThreshold=3 and maxLoopIterations=8).
   */
  loopEscalationThreshold: number;
  /**
   * Number of turns the looping tool stays disabled after an escalation
   * fires. Without this cooldown the agent could re-call the tool next
   * turn, drop the loop count, and re-trigger escalation forever. Default
   * 3 (covers the turns between escalation and hard-stop).
   */
  loopEscalationCooldownTurns: number;
  /** Max output tokens per LLM call. */
  maxOutputTokens: number;
  /** Timeout for individual tool execution in milliseconds. Default 30_000. */
  toolTimeoutMs: number;
  /** Timeout for user confirmation in milliseconds. Default 300_000 (5 minutes). */
  confirmationTimeoutMs: number;
  /** Number of recent turns to keep verbatim during compaction. Default 6. */
  keepRecentTurns: number;
  /** Max tokens for the compaction summary. Default 4_000. */
  maxSummaryTokens: number;
  /** Consecutive compaction failures before circuit breaker trips. Default 3. */
  compactionCircuitBreaker: number;
  /**
   * Timeout for each `summarizeToolResult` callback call, in milliseconds.
   * Tool results can be sizeable so small models still need breathing room.
   * Default 5_000. Exceeding timeout falls back to the static cleared marker.
   */
  summarizerTimeoutMs: number;
  /**
   * Max concurrent `summarizeToolResult` calls during one clearing pass.
   * Context clearing can evict 10+ results at once; unlimited fan-out can
   * hit provider rate limits (esp. Anthropic). Default 4.
   */
  summarizerConcurrency: number;
}

export const DEFAULT_LOOP_CONFIG: AgentLoopConfig = {
  maxResultSize: 20_000,
  compactThreshold: 0.7,
  keepRecentResults: 5,
  clearThreshold: 15,
  maxLoopIterations: 12,
  loopWarningThreshold: 5,
  loopEscalationThreshold: 8,
  loopEscalationCooldownTurns: 1,
  maxOutputTokens: 16_384,
  toolTimeoutMs: 30_000,
  confirmationTimeoutMs: 300_000,
  keepRecentTurns: 6,
  maxSummaryTokens: 4_000,
  compactionCircuitBreaker: 3,
  summarizerTimeoutMs: 5_000,
  summarizerConcurrency: 4,
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

  /**
   * Optional **token** budget for the session (not dollars — token cost
   * varies by model). When `ctx.usage.totalTokens` reaches this value, the
   * loop transitions to `done` with reason `budget_exceeded`. Undefined
   * means no budget cap — the session runs until another terminal condition
   * (`max_turns`, `loop_detected`, `model_stop`, etc.) fires.
   *
   * Counts input + output tokens across ALL turns in the session (cumulative).
   *
   * This is a **soft ceiling**, not a hard cap. The check runs between state
   * transitions, so the in-flight turn completes first. Practical overshoot
   * on a single turn can be up to `maxOutputTokens` + the total size of tool
   * results that turn produced. Size the cap with that headroom in mind —
   * e.g., set it ~20% below your hard limit.
   *
   * For dollar-denominated budgets, use the `onUsage` callback to convert
   * tokens to cost via your own provider pricing table.
   */
  maxSessionTokens?: number;

  /** Loop config */
  config: AgentLoopConfig;

  /** Mutable: consecutive compaction failures (circuit breaker counter) */
  compactionFailures: number;

  /** Cache for pre-executed read-only tool results (populated during STREAMING) */
  preExecutionCache: Map<string, Promise<unknown>>;

  /**
   * Map of tool names temporarily disabled after a loop-escalation event,
   * to the turn count at which they may return. Checked in THINKING when
   * building the tool set for streamText. Prevents the "escalation ->
   * re-call same tool next turn -> loop count drops -> escalation fires
   * again" oscillation.
   */
  disabledToolsUntilTurn: Map<string, number>;

  /**
   * Set of tool-call IDs the user has already approved via `CONFIRMING`.
   * Consulted by EXECUTING before routing a confirmation-gated tool call
   * to CONFIRMING — prevents an infinite EXECUTING → CONFIRMING → EXECUTING
   * loop after the user approves.
   *
   * Note: this set is **not persisted** when the session is persisted and
   * resumed. If a client disconnects mid-confirmation and reconnects, any
   * previously approved tool call will re-prompt. Acceptable trade-off —
   * resume should re-confirm anyway, since the user state may have shifted.
   */
  confirmedCallIds: Set<string>;

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

  /**
   * Optional callback fired after each turn with token usage.
   * Default is no-op. Billing integrations hook in here.
   */
  onUsage?: (usage: TurnUsage) => void;

  /**
   * Optional hook that produces a 1-2 sentence summary of a tool result
   * that is being cleared from context. When set, the agent loop calls
   * this for each tool result body it evicts, so the assistant retains a
   * short signal of "what happened" instead of a generic marker.
   *
   * If unset, cleared messages fall back to a static marker. The hook
   * should be cheap (e.g. a Haiku call) — callers are welcome to short-
   * circuit or cache. Summarization failures are swallowed by the loop
   * and fall back to the marker.
   */
  summarizeToolResult?: (opts: {
    toolName: string;
    content: string;
    signal: AbortSignal;
  }) => Promise<string>;
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
