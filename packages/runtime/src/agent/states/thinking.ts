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
    messages = [...messages, {
      role: 'system',
      content: `[Warning] You have called ${loop.toolName} ${loop.count} times with similar parameters. Try a different approach.`,
    } as ModelMessage];
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
    tools[name] = {
      description: def.description,
      // ToolDefinition.parameters is either a Zod schema or FlexibleSchema —
      // both are accepted by AI SDK as inputSchema
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
 * If the same tool name appears 3+ times, returns the tool and count.
 * Phase 3.3 upgrades this with parameter similarity checking.
 */
function detectLoop(messages: ModelMessage[]): LoopInfo | null {
  const recentMessages = messages.slice(-16);
  const toolCallCounts = new Map<string, number>();

  for (const msg of recentMessages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if ('type' in part && part.type === 'tool-call' && 'toolName' in part) {
        const name = part.toolName;
        toolCallCounts.set(name, (toolCallCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Find the most repeated tool
  let maxTool: string | null = null;
  let maxCount = 0;
  for (const [name, count] of toolCallCounts) {
    if (count > maxCount) {
      maxTool = name;
      maxCount = count;
    }
  }

  if (maxTool && maxCount >= 3) {
    return {toolName: maxTool, count: maxCount};
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool result clearing
// ---------------------------------------------------------------------------

/**
 * Replace old tool result bodies with one-line summaries.
 *
 * If there are more than `threshold` tool result messages, keep the last
 * `keepRecent` full and replace older ones with "[Tool result cleared]".
 * Phase 3.3 upgrades this with actual content summarization.
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
    result[idx] = {
      role: 'tool',
      content: [{
        type: 'tool-result' as const,
        toolCallId: 'cleared',
        toolName: 'cleared',
        output: {type: 'text' as const, value: '[Tool result cleared to save context space]'},
      }],
    } as ModelMessage;
  }

  return result;
}
