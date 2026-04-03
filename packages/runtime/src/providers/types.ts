/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider abstraction wrapping the Vercel AI SDK.
 *
 * This is the boundary between Amodal code and the AI SDK. The rest of
 * the runtime talks to LLMProvider, never to the SDK directly. This lets
 * us swap SDK versions, add new providers, or intercept calls (logging,
 * retries, cost tracking) in one place.
 */

import type {
  LanguageModel,
  ModelMessage,
  Tool,
  ToolChoice,
  ToolSet,
} from 'ai';

// ---------------------------------------------------------------------------
// Options for streamText / generateText calls
// ---------------------------------------------------------------------------

export interface StreamTextOptions {
  messages: ModelMessage[];
  system?: string;
  tools?: Record<string, Tool>;
  toolChoice?: ToolChoice<ToolSet>;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface GenerateTextOptions {
  messages: ModelMessage[];
  system?: string;
  tools?: Record<string, Tool>;
  toolChoice?: ToolChoice<ToolSet>;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Result types (normalized from AI SDK responses)
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens: number;
}

export interface StreamTextResult {
  /** The full text stream — yields string chunks */
  textStream: AsyncIterable<string>;
  /** The full event stream — yields structured events including tool calls */
  fullStream: AsyncIterable<StreamEvent>;
  /** Resolves when the stream is complete with final usage */
  usage: PromiseLike<TokenUsage>;
  /** Resolves with the complete response text */
  text: PromiseLike<string>;
}

export type StreamEvent =
  | {type: 'text-delta'; textDelta: string}
  | {type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown>}
  | {type: 'tool-result'; toolCallId: string; toolName: string; result: unknown}
  | {type: 'finish'; usage: TokenUsage}
  | {type: 'error'; error: unknown};

export interface GenerateTextResult {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>;
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
}

// ---------------------------------------------------------------------------
// LLMProvider interface
// ---------------------------------------------------------------------------

/**
 * Unified LLM provider interface.
 *
 * Wraps the Vercel AI SDK so the rest of the runtime never imports `ai`
 * directly. Implementations exist for Anthropic, OpenAI, Google, and
 * any OpenAI-compatible provider (DeepSeek, Groq, Mistral, etc.).
 */
export interface LLMProvider {
  /** Stream a text/tool response from the LLM */
  streamText(opts: StreamTextOptions): StreamTextResult;

  /** Generate a complete text response (non-streaming) */
  generateText(opts: GenerateTextOptions): Promise<GenerateTextResult>;

  /** The model identifier (e.g., 'claude-sonnet-4-20250514') */
  readonly model: string;

  /** The provider name (e.g., 'anthropic', 'openai', 'google') */
  readonly provider: string;

  /** The underlying AI SDK LanguageModel instance (for advanced use) */
  readonly languageModel: LanguageModel;
}

// ---------------------------------------------------------------------------
// Provider config (maps to our ModelConfig)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Provider name: 'anthropic', 'openai', 'google', 'deepseek', etc. */
  provider: string;
  /** Model name: 'claude-sonnet-4-20250514', 'gpt-4o', etc. */
  model: string;
  /** API key (resolved from env or credentials) */
  apiKey?: string;
  /** Custom base URL (for self-hosted or proxy endpoints) */
  baseUrl?: string;
  /** AWS region (for Bedrock) */
  region?: string;
}
