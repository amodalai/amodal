/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider-neutral LLM interface for the agent runtime.
 *
 * Separate from the existing ContentGenerator (which uses @google/genai types)
 * to keep a clean, minimal abstraction for the ReAct loop.
 */

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface LLMChatRequest {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LLMMessage =
  | LLMUserMessage
  | LLMAssistantMessage
  | LLMToolResultMessage;

export interface LLMUserMessage {
  role: 'user';
  content: string;
}

export interface LLMAssistantMessage {
  role: 'assistant';
  content: LLMResponseBlock[];
}

export interface LLMToolResultMessage {
  role: 'tool_result';
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface LLMChatResponse {
  content: LLMResponseBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage?: {inputTokens: number; outputTokens: number};
}

export type LLMResponseBlock = LLMTextBlock | LLMToolUseBlock;

export interface LLMTextBlock {
  type: 'text';
  text: string;
}

export interface LLMToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

import type {LLMStreamEvent} from './streaming-types.js';

export interface RuntimeProvider {
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
  chatStream?(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent>;
}
