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

/** Sentinel values for cleared tool results. */
const CLEARED_TOOL_CALL_ID = 'cleared';
const CLEARED_TOOL_NAME = 'cleared';
const CLEARED_TOOL_RESULT_TEXT = '[Tool result cleared to save context space]';

/**
 * Handle the THINKING state.
 *
 * Increments turnCount, checks for loops, clears old results,
 * then initiates a streaming LLM call.
 */
export function handleThinking(
  state: ThinkingState,
  ctx: AgentContext,
): TransitionResult {
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

  let messages = state.messages;

  if (loop && loop.count >= ctx.config.loopWarningThreshold) {
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

  // 3. Clear old tool result bodies — keep last N full, replace older with summaries
  //    Prevents unbounded context growth in tool-heavy sessions.
  messages = clearOldToolResults(messages, ctx.config.clearThreshold, ctx.config.keepRecentResults);

  // 4. Build tool schemas for the AI SDK (strip execute functions — we handle
  //    execution ourselves in EXECUTING state with permission checks, SSE events, etc.)
  //    AI SDK v6 uses `inputSchema`, not `parameters`.
  const allTools = ctx.toolRegistry.getTools();
  const tools: Record<string, Tool> = {};
  for (const [name, def] of Object.entries(allTools)) {
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
 * If there are more than `threshold` tool result messages, keep the last
 * `keepRecent` full and replace older ones with "[Tool result cleared]".
 * TODO: replace the marker with an actual LLM-generated summary of the
 * cleared content.
 */
function clearOldToolResults(
  messages: ModelMessage[],
  threshold: number,
  keepRecent: number,
): ModelMessage[] {
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
  const result = [...messages];

  for (const idx of indicesToClear) {
    const cleared: ModelMessage = {
      role: 'tool',
      content: [{
        type: 'tool-result' as const,
        toolCallId: CLEARED_TOOL_CALL_ID,
        toolName: CLEARED_TOOL_NAME,
        output: {type: 'text' as const, value: CLEARED_TOOL_RESULT_TEXT},
      }],
    };
    result[idx] = cleared;
  }

  return result;
}
