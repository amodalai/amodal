/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
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

export type LLMUserContentPart = LLMUserTextPart | LLMUserImagePart;

export interface LLMUserTextPart {
  type: 'text';
  text: string;
}

export interface LLMUserImagePart {
  type: 'image';
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string; // base64-encoded
}

export interface LLMUserMessage {
  role: 'user';
  content: string | LLMUserContentPart[];
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
  usage?: LLMUsage;
}

/**
 * Token usage returned by an LLM call.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
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
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface RuntimeProvider {
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
  chatStream?(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent>;
}

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export type LLMStreamEvent =
  | LLMStreamTextDelta
  | LLMStreamToolUseStart
  | LLMStreamToolUseDelta
  | LLMStreamToolUseEnd
  | LLMStreamMessageEnd;

export interface LLMStreamTextDelta {
  type: 'text_delta';
  text: string;
}

export interface LLMStreamToolUseStart {
  type: 'tool_use_start';
  id: string;
  name: string;
}

export interface LLMStreamToolUseDelta {
  type: 'tool_use_delta';
  id: string;
  inputDelta: string;
}

export interface LLMStreamToolUseEnd {
  type: 'tool_use_end';
  id: string;
  input: Record<string, unknown>;
}

export interface LLMStreamMessageEnd {
  type: 'message_end';
  stopReason: LLMChatResponse['stopReason'];
  usage?: LLMUsage;
}
