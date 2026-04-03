/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * THINKING state handler.
 *
 * Prepares and sends a request to the LLM:
 * 1. Detect tool call loops
 * 2. Clear old tool result bodies
 * 3. Strip execute functions from tools (schemas only for AI SDK)
 * 4. Call provider.streamText()
 * 5. Transition to STREAMING
 */

import type {Tool} from 'ai';
import {SSEEventType} from '../../types.js';
import type {
  ThinkingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';

/**
 * Handle the THINKING state.
 *
 * Increments turnCount, injects loop warnings if needed,
 * then initiates a streaming LLM call.
 */
export function handleThinking(
  state: ThinkingState,
  ctx: AgentContext,
): TransitionResult {
  const effects = [];

  // 1. Increment turn counter
  ctx.turnCount++;

  // 2. Build tool schemas for the AI SDK (strip execute functions — we handle
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

  // 3. Emit thinking_start
  const timestamp = new Date().toISOString();
  effects.push({
    type: SSEEventType.TextDelta as const,
    content: '',
    timestamp,
  });

  ctx.logger.debug('agent_thinking_start', {
    session: ctx.sessionId,
    turn: ctx.turnCount,
    messageCount: state.messages.length,
    toolCount: Object.keys(tools).length,
  });

  // 4. Start streaming LLM call
  const result = ctx.provider.streamText({
    messages: state.messages,
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
