/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LLMChatResponse} from './runtime-provider-types.js';

/**
 * Events emitted during streamed LLM responses.
 *
 * Consumers accumulate tool_use events (start + deltas + end) into complete
 * tool calls. Text deltas can be forwarded immediately for real-time UX.
 */
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
  usage?: {inputTokens: number; outputTokens: number};
}
