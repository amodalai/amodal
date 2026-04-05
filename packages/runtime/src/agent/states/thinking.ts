/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * THINKING state handler.
 *
 * Prepares and sends a request to the LLM:
 * 1. Detect tool call loops (warn at 3+, force stop at maxLoopIterations)
 * 2. Clear old tool result bodies (keep last N full, summarize rest)
 * 3. Strip execute functions from tools (schemas only for AI SDK)
 * 4. Call provider.streamText()
 * 5. Transition to STREAMING
 */

import type {Tool, ModelMessage} from 'ai';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import type {
  ThinkingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';

/** Content markers for cleared tool results. Original toolCallId and
 *  toolName are preserved so assistant tool-calls still pair with their
 *  results (providers reject orphaned tool_use blocks). */
const CLEARED_TOOL_RESULT_TEXT = '[Tool result cleared to save context space]';
/** Prefix used on every cleared/summarized marker — lets us detect
 *  already-cleared messages idempotently. */
const CLEARED_TEXT_PREFIXES = ['[Tool result cleared', '[Summary of '] as const;
/** Max time a summarizer callback can take before we fall back to the marker. */
const SUMMARIZER_TIMEOUT_MS = 5_000;

/**
 * Handle the THINKING state.
 *
 * Increments turnCount, checks for loops, clears old results,
 * then initiates a streaming LLM call.
 */
export async function handleThinking(
  state: ThinkingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  const effects: SSEEvent[] = [];

  // 1. Increment turn counter
  ctx.turnCount++;

  // 2. Loop detection — check before spending tokens on an LLM call
  const loop = detectLoop(state.messages);
  if (loop && loop.count >= ctx.config.maxLoopIterations) {
    ctx.logger.warn('agent_loop_detected', {
      session: ctx.sessionId,
      tool: loop.toolName,
      count: loop.count,
    });
    return {
      next: {type: 'done', usage: {...ctx.usage}, reason: 'loop_detected'},
      effects: [{
        type: SSEEventType.Error,
        message: `Agent stuck in a loop: ${loop.toolName} called ${loop.count} times with similar parameters`,
        timestamp: new Date().toISOString(),
      }],
    };
  }

  // Clear old tool result bodies and persist back to ctx. Without this
  // writeback, every subsequent turn re-calls the summarizer hook for the
  // same messages (expensive). Once a result is cleared, it stays cleared.
  // Must happen before turn-specific warnings are appended, since warnings
  // are local-to-this-turn and should not persist.
  ctx.messages = await clearOldToolResults(state.messages, ctx);
  let messages = ctx.messages;
  /** Tool names to exclude from this turn's tool set (escalation tier). */
  const excludedTools = new Set<string>();

  if (loop && loop.count >= ctx.config.loopEscalationThreshold) {
    // Escalation tier: strongly nudge the model AND remove the looping
    // tool from this turn's tool set, forcing a different approach.
    ctx.logger.warn('agent_loop_escalation', {
      session: ctx.sessionId,
      tool: loop.toolName,
      count: loop.count,
    });
    excludedTools.add(loop.toolName);
    const escalationMessage: ModelMessage = {
      role: 'system',
      content: `[Escalation] You have called ${loop.toolName} ${loop.count} times with similar parameters and are not making progress. The ${loop.toolName} tool has been temporarily disabled for this turn — use a different tool or ask the user for help.`,
    };
    messages = [...messages, escalationMessage];
  } else if (loop && loop.count >= ctx.config.loopWarningThreshold) {
    ctx.logger.info('agent_loop_warning', {
      session: ctx.sessionId,
      tool: loop.toolName,
      count: loop.count,
    });
    const warningMessage: ModelMessage = {
      role: 'system',
      content: `[Warning] You have called ${loop.toolName} ${loop.count} times with similar parameters. Try a different approach.`,
    };
    messages = [...messages, warningMessage];
  }

  // 4. Build tool schemas for the AI SDK (strip execute functions — we handle
  //    execution ourselves in EXECUTING state with permission checks, SSE events, etc.)
  //    AI SDK v6 uses `inputSchema`, not `parameters`.
  const allTools = ctx.toolRegistry.getTools();
  const tools: Record<string, Tool> = {};
  for (const [name, def] of Object.entries(allTools)) {
    if (excludedTools.has(name)) continue;
    // ToolDefinition.parameters is either a Zod schema or FlexibleSchema —
    // both are accepted by AI SDK as inputSchema.

    tools[name] = {
      description: def.description,
      inputSchema: def.parameters,
    } as Tool;
  }

  ctx.logger.debug('agent_thinking_start', {
    session: ctx.sessionId,
    turn: ctx.turnCount,
    messageCount: messages.length,
    toolCount: Object.keys(tools).length,
  });

  // 5. Start streaming LLM call
  const result = ctx.provider.streamText({
    messages,
    system: ctx.systemPrompt,
    tools,
    maxOutputTokens: ctx.config.maxOutputTokens,
    abortSignal: ctx.signal,
  });

  return {
    next: {type: 'streaming', stream: result, pendingToolCalls: []},
    effects,
  };
}

// ---------------------------------------------------------------------------
// Loop detection
// ---------------------------------------------------------------------------

interface LoopInfo {
  toolName: string;
  count: number;
}

/**
 * Detect repeated tool calls in recent message history.
 *
 * Scans the last 16 messages for assistant tool-call content parts.
 * Groups calls by tool name and checks for parameter similarity.
 * A tool is considered looping when it has 3+ calls with similar
 * parameters (same keys, same or similar values).
 */
function detectLoop(messages: ModelMessage[]): LoopInfo | null {
  const recentMessages = messages.slice(-16);

  // Collect tool calls with their serialized args for similarity checking
  const callsByTool = new Map<string, string[]>();

  for (const msg of recentMessages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if ('type' in part && part.type === 'tool-call' && 'toolName' in part) {
        const name = part.toolName;
        const args = 'input' in part ? JSON.stringify(part.input) : '{}';
        const existing = callsByTool.get(name) ?? [];
        existing.push(args);
        callsByTool.set(name, existing);
      }
    }
  }

  // Find the most repeated tool with similar parameters
  let maxTool: string | null = null;
  let maxCount = 0;

  for (const [name, argsList] of callsByTool) {
    // Count how many calls share similar parameters.
    // Group by serialized args — exact duplicates are obvious loops.
    // Also count near-duplicates where only values differ slightly.
    const similarCount = countSimilarCalls(argsList);
    if (similarCount > maxCount) {
      maxTool = name;
      maxCount = similarCount;
    }
  }

  if (maxTool && maxCount >= 3) {
    return {toolName: maxTool, count: maxCount};
  }
  return null;
}

/**
 * Count the size of the largest group of similar argument sets.
 *
 * Two arg sets are "similar" if they share the same keys and at least
 * half their values are identical. This catches loops where the agent
 * retries with slightly different parameters (e.g., changing a page number
 * but keeping everything else the same).
 */
function countSimilarCalls(argsList: string[]): number {
  if (argsList.length <= 2) return argsList.length;

  // Fast path: if most are exact duplicates, just count those
  const counts = new Map<string, number>();
  for (const args of argsList) {
    counts.set(args, (counts.get(args) ?? 0) + 1);
  }
  const maxExact = Math.max(...counts.values());
  if (maxExact >= 3) return maxExact;

  // Slow path: parse and compare keys/values for similarity
  const parsed: Array<Record<string, unknown>> = [];
  for (const args of argsList) {
    try {
      const obj: unknown = JSON.parse(args);
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns unknown; narrowed to non-null non-array object above
        parsed.push(obj as Record<string, unknown>);
      }
    } catch {
      // Unparseable — treat each as unique
    }
  }

  if (parsed.length <= 2) return argsList.length;

  // Group by key set, then check value similarity within groups
  const byKeys = new Map<string, Array<Record<string, unknown>>>();
  for (const obj of parsed) {
    const keyStr = Object.keys(obj).sort().join(',');
    const group = byKeys.get(keyStr) ?? [];
    group.push(obj);
    byKeys.set(keyStr, group);
  }

  let largestSimilarGroup = 0;
  for (const group of byKeys.values()) {
    if (group.length < 3) continue;
    // Within a key group, count pairs with >50% identical values
    // Use first element as reference and count how many are similar to it
    const ref = group[0];
    const keys = Object.keys(ref);
    let similarToRef = 1;
    for (let i = 1; i < group.length; i++) {
      const matching = keys.filter((k) => JSON.stringify(ref[k]) === JSON.stringify(group[i][k]));
      if (matching.length >= keys.length / 2) {
        similarToRef++;
      }
    }
    largestSimilarGroup = Math.max(largestSimilarGroup, similarToRef);
  }

  return Math.max(maxExact, largestSimilarGroup);
}

// ---------------------------------------------------------------------------
// Tool result clearing
// ---------------------------------------------------------------------------

/**
 * Replace old tool result bodies with one-line summaries.
 *
 * If there are more than `ctx.config.clearThreshold` tool result messages,
 * keep the last `ctx.config.keepRecentResults` full and replace older ones
 * with a cleared marker.
 *
 * When `ctx.summarizeToolResult` is provided, each newly-cleared message
 * gets an LLM-generated 1-2 sentence summary of its body (in parallel).
 * Already-cleared messages are skipped (idempotent). Summarization
 * failures degrade to the static marker so context clearing never
 * blocks the main loop.
 */
async function clearOldToolResults(
  messages: ModelMessage[],
  ctx: AgentContext,
): Promise<ModelMessage[]> {
  const threshold = ctx.config.clearThreshold;
  const keepRecent = ctx.config.keepRecentResults;

  // Count tool result messages
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      toolResultIndices.push(i);
    }
  }

  if (toolResultIndices.length <= threshold) {
    return messages;
  }

  // Keep the last `keepRecent` tool results full, clear the rest
  const indicesToClear = toolResultIndices.slice(0, -keepRecent);

  // Partition: skip already-cleared (idempotent), summarize the rest.
  const summaryPromises = indicesToClear.map(async (idx): Promise<{
    idx: number;
    cleared: ModelMessage;
  }> => {
    const existing = messages[idx];
    const toolCallId = extractToolCallId(existing);
    const toolName = extractToolName(existing);
    const body = extractToolResultText(existing);

    // Already-cleared messages: keep the existing marker unchanged
    if (isAlreadyCleared(existing)) {
      return {idx, cleared: existing};
    }

    const markerText = await summarizeOrFallback(
      toolName,
      body,
      ctx.summarizeToolResult,
      ctx.signal,
      ctx.logger,
      ctx.sessionId,
    );

    // CRITICAL: preserve the original toolCallId and toolName. Providers
    // (Anthropic especially) require every assistant tool-call to have
    // a matching tool-result with the same toolCallId; rewriting it
    // breaks the conversation with "tool results are missing" errors.
    return {
      idx,
      cleared: {
        role: 'tool',
        content: [{
          type: 'tool-result' as const,
          toolCallId,
          toolName,
          output: {type: 'text' as const, value: markerText},
        }],
      },
    };
  });

  const resolved = await Promise.all(summaryPromises);

  const result = [...messages];
  for (const {idx, cleared} of resolved) {
    result[idx] = cleared;
  }
  return result;
}

/** Extract the assistant-visible text from a tool-result message. */
function extractToolResultText(msg: ModelMessage): string {
  if (msg.role !== 'tool') return '';
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const parts: string[] = [];
  for (const part of msg.content) {
    if ('output' in part && part.output && typeof part.output === 'object' && 'value' in part.output) {
      const value = part.output.value;
      if (typeof value === 'string') parts.push(value);
      else parts.push(JSON.stringify(value));
    }
  }
  return parts.join('\n');
}

/** Extract the original tool name from a tool-result message, if available. */
function extractToolName(msg: ModelMessage): string {
  if (msg.role !== 'tool' || !Array.isArray(msg.content)) return 'unknown';
  for (const part of msg.content) {
    if ('toolName' in part && typeof part.toolName === 'string') return part.toolName;
  }
  return 'unknown';
}

/** Extract the original toolCallId from a tool-result message. */
function extractToolCallId(msg: ModelMessage): string {
  if (msg.role !== 'tool' || !Array.isArray(msg.content)) return 'unknown';
  for (const part of msg.content) {
    if ('toolCallId' in part && typeof part.toolCallId === 'string') return part.toolCallId;
  }
  return 'unknown';
}

/** True if this message has already been replaced with the cleared marker.
 *  Detected by content prefix since we no longer overwrite toolCallId. */
function isAlreadyCleared(msg: ModelMessage): boolean {
  if (msg.role !== 'tool' || !Array.isArray(msg.content)) return false;
  for (const part of msg.content) {
    if ('output' in part && part.output && typeof part.output === 'object' && 'value' in part.output) {
      const value = part.output.value;
      if (typeof value === 'string' && CLEARED_TEXT_PREFIXES.some((p) => value.startsWith(p))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Produce replacement text for a cleared tool result. Uses the summarizer
 * hook if provided; falls back to the static marker on any failure.
 */
async function summarizeOrFallback(
  toolName: string,
  content: string,
  summarize: AgentContext['summarizeToolResult'],
  signal: AbortSignal,
  logger: AgentContext['logger'],
  sessionId: string,
): Promise<string> {
  if (!summarize || content.length === 0) return CLEARED_TOOL_RESULT_TEXT;
  // Bound the callback so a hung summarizer can never block the main loop.
  // The session signal is ANDed in so a parent abort still tears this down.
  const timeoutSignal = AbortSignal.any([signal, AbortSignal.timeout(SUMMARIZER_TIMEOUT_MS)]);
  try {
    const summary = await summarize({toolName, content, signal: timeoutSignal});
    const trimmed = summary.trim();
    if (trimmed.length === 0) return CLEARED_TOOL_RESULT_TEXT;
    return `[Summary of ${toolName}: ${trimmed}]`;
  } catch (err) {
    logger.warn('tool_result_summarization_failed', {
      session: sessionId,
      tool: toolName,
      error: err instanceof Error ? err.message : String(err),
    });
    return CLEARED_TOOL_RESULT_TEXT;
  }
}
