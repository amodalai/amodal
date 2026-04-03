/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Content generator bridge that routes upstream GeminiClient LLM calls
 * through the Vercel AI SDK via our LLMProvider interface.
 *
 * Implements the same structural interface as MultiProviderContentGenerator
 * (generateContent, generateContentStream, countTokens, embedContent) so
 * it can be set on the upstream Config via the same private field pattern.
 *
 * Request conversion: Google GenerateContentParams → LLMChatRequest → AI SDK
 * Response conversion: AI SDK StreamEvent → Google GenerateContentResponse
 */

import type {ModelMessage, ToolSet, ToolCallPart, ToolResultPart, TextPart} from 'ai';
import {jsonSchema, tool} from 'ai';

import {log} from '../logger.js';
import {ProviderError} from '../errors.js';
import {createProvider} from './create-provider.js';
import type {
  LLMProvider,
  ProviderConfig,
  StreamEvent,
  TokenUsage,
} from './types.js';

import type {
  LLMMessage,
  LLMToolDefinition,
  ModelConfig,
} from '@amodalai/types';

import {
  convertGenerateContentParams,
  normalizeContents,
  type GGenerateContentParams,
} from '@amodalai/core';

/** Default timeout for LLM calls when no AbortSignal is provided (2 minutes). */
const DEFAULT_LLM_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// ModelConfig → ProviderConfig
// ---------------------------------------------------------------------------

/** Provider name → env var name for the API key */
const API_KEY_ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  bedrock: 'AWS_ACCESS_KEY_ID',
  azure: 'AZURE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  together: 'TOGETHER_API_KEY',
};

/**
 * Convert a ModelConfig (from amodal.json) to a ProviderConfig (for createProvider).
 * Resolves the API key from credentials or environment variables.
 */
export function modelConfigToProviderConfig(mc: ModelConfig): ProviderConfig {
  const envVar = API_KEY_ENV_VARS[mc.provider] ?? `${mc.provider.toUpperCase()}_API_KEY`;
  const apiKey = mc.credentials?.[envVar]
    ?? mc.credentials?.['OPENAI_API_KEY'] // OpenAI-compat providers often use this
    ?? process.env[envVar]
    ?? undefined;

  return {
    provider: mc.provider,
    model: mc.model,
    apiKey,
    baseUrl: mc.baseUrl,
    region: mc.region,
  };
}

// ---------------------------------------------------------------------------
// Google response type aliases (structural — avoids hard dep on @google/genai)
// ---------------------------------------------------------------------------

interface GPart {
  text?: string;
  functionCall?: {id?: string; name?: string; args?: Record<string, unknown>};
  [key: string]: unknown;
}

interface GCandidate {
  content?: {role?: string; parts?: GPart[]};
  finishReason?: string;
  index?: number;
}

interface GUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GGenerateContentResponse {
  candidates?: GCandidate[];
  usageMetadata?: GUsageMetadata;
  responseId?: string;
}

// ---------------------------------------------------------------------------
// Token estimation (matches gemini-cli-core heuristic)
// ---------------------------------------------------------------------------

const ASCII_TOKENS_PER_CHAR = 0.25;
const NON_ASCII_TOKENS_PER_CHAR = 1.3;

function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) <= 127
      ? ASCII_TOKENS_PER_CHAR
      : NON_ASCII_TOKENS_PER_CHAR;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// LLMMessage → AI SDK ModelMessage conversion
// ---------------------------------------------------------------------------

function llmMessagesToModelMessages(messages: LLMMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  // Build toolCallId → toolName lookup from assistant messages so tool_result
  // messages can include the correct toolName (required by some providers).
  const toolNameByCallId = new Map<string, string>();

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', content: msg.content});
        break;

      case 'assistant': {
        const parts: Array<TextPart | ToolCallPart> = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({type: 'text', text: block.text});
          } else if (block.type === 'tool_use') {
            toolNameByCallId.set(block.id, block.name);
            parts.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            } satisfies ToolCallPart);
          }
        }
        result.push({role: 'assistant', content: parts});
        break;
      }

      case 'tool_result':
        result.push({
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: msg.toolCallId,
            toolName: toolNameByCallId.get(msg.toolCallId) ?? '',
            output: msg.isError
              ? {type: 'text', value: `Error: ${msg.content}`}
              : {type: 'text', value: msg.content},
          } satisfies ToolResultPart],
        });
        break;

      default:
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// LLMToolDefinition → AI SDK ToolSet
// ---------------------------------------------------------------------------

function llmToolsToToolSet(tools: LLMToolDefinition[]): ToolSet {
  const toolSet: ToolSet = {};

  for (const def of tools) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters),
    });
  }

  return toolSet;
}

// ---------------------------------------------------------------------------
// AI SDK → Google response format conversion
// ---------------------------------------------------------------------------

function mapStopReason(finishReason: string | undefined): string {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- finishReason is string|undefined, default handles unknown values
  switch (finishReason) {
    case 'stop':
      return 'STOP';
    case 'tool-calls':
      return 'STOP';
    case 'length':
      return 'MAX_TOKENS';
    case 'content-filter':
      return 'SAFETY';
    default:
      return 'STOP';
  }
}

function usageToGoogleMetadata(usage: TokenUsage | undefined): GUsageMetadata | undefined {
  if (!usage) return undefined;
  const allInput = usage.inputTokens + (usage.cachedInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
  return {
    promptTokenCount: allInput,
    candidatesTokenCount: usage.outputTokens,
    totalTokenCount: allInput + usage.outputTokens,
    cachedContentTokenCount: usage.cachedInputTokens,
  };
}

/**
 * Attach `functionCalls` and `text` getters that upstream GeminiChat uses.
 */
function attachGetters(resp: GGenerateContentResponse): void {
  Object.defineProperty(resp, 'functionCalls', {
    get() {
      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts) return undefined;
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => p.functionCall);
      return calls.length > 0 ? calls : undefined;
    },
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(resp, 'text', {
    get() {
      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts) return undefined;
      const texts = parts.filter((p) => p.text).map((p) => p.text);
      return texts.length > 0 ? texts.join('') : undefined;
    },
    enumerable: false,
    configurable: true,
  });
}

function makeChunk(parts: GPart[], finishReason?: string, usage?: GUsageMetadata): GGenerateContentResponse {
  const chunk: GGenerateContentResponse = {
    candidates: [{
      content: {role: 'model', parts},
      finishReason,
      index: 0,
    }],
  };
  if (usage) {
    chunk.usageMetadata = usage;
  }
  attachGetters(chunk);
  return chunk;
}

// ---------------------------------------------------------------------------
// VercelContentGenerator
// ---------------------------------------------------------------------------

export class VercelContentGenerator {
  private readonly provider: LLMProvider;

  constructor(modelConfig: ModelConfig) {
    const providerConfig = modelConfigToProviderConfig(modelConfig);
    this.provider = createProvider(providerConfig);
  }

  /**
   * Non-streaming content generation.
   */
  async generateContent(
    request: GGenerateContentParams,
    _userPromptId: string,
    _role: unknown,
  ): Promise<GGenerateContentResponse> {
    const llmRequest = convertGenerateContentParams(request);
    log.debug('generateContent', {
      tools: llmRequest.tools.length,
      messages: llmRequest.messages.length,
      tag: 'llm',
    });

    const modelMessages = llmMessagesToModelMessages(llmRequest.messages);
    const tools = llmRequest.tools.length > 0 ? llmToolsToToolSet(llmRequest.tools) : undefined;

    const result = await this.provider.generateText({
      messages: modelMessages,
      system: llmRequest.systemPrompt || undefined,
      tools,
      maxOutputTokens: llmRequest.maxTokens,
      abortSignal: llmRequest.signal ?? AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS),
    });

    // Build parts from text + tool calls
    const parts: GPart[] = [];
    if (result.text) {
      parts.push({text: result.text});
    }
    for (const tc of result.toolCalls) {
      parts.push({
        functionCall: {
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.args,
        },
      });
    }

    const chunk = makeChunk(
      parts,
      mapStopReason(result.finishReason),
      usageToGoogleMetadata(result.usage),
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural match to upstream GenerateContentResponse class
    return chunk as unknown as GGenerateContentResponse;
  }

  /**
   * Streaming content generation.
   */
  async generateContentStream(
    request: GGenerateContentParams,
    _userPromptId: string,
    _role: unknown,
  ): Promise<AsyncGenerator<GGenerateContentResponse>> {
    const llmRequest = convertGenerateContentParams(request);
    log.debug('generateContentStream', {
      tools: llmRequest.tools.length,
      messages: llmRequest.messages.length,
      tag: 'llm',
    });

    const modelMessages = llmMessagesToModelMessages(llmRequest.messages);
    const tools = llmRequest.tools.length > 0 ? llmToolsToToolSet(llmRequest.tools) : undefined;

    const streamResult = this.provider.streamText({
      messages: modelMessages,
      system: llmRequest.systemPrompt || undefined,
      tools,
      maxOutputTokens: llmRequest.maxTokens,
      abortSignal: llmRequest.signal ?? AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS),
    });

    return this.yieldGoogleChunks(streamResult.fullStream);
  }

  /**
   * Estimate token count using the same heuristic as gemini-cli-core:
   * 0.25 tokens/char for ASCII, 1.3 tokens/char for non-ASCII.
   * Function responses are serialized to JSON and counted as text.
   *
   * This is only called by the upstream for media-heavy requests (images/files).
   * For text-only requests, the upstream uses its own estimateTokenCountSync.
   */
  async countTokens(
    request: {contents: unknown; model?: string},
  ): Promise<{totalTokens: number}> {
    const contents = normalizeContents(request.contents);
    let tokens = 0;
    for (const content of contents) {
      for (const part of (content.parts ?? [])) {
        if (typeof part.text === 'string') {
          tokens += estimateTextTokens(part.text);
        } else if (part.functionResponse) {
          // Serialize function response to count its tokens
          const json = JSON.stringify(part.functionResponse);
          tokens += estimateTextTokens(json);
        } else if (part.functionCall) {
          const json = JSON.stringify(part.functionCall);
          tokens += estimateTextTokens(json);
        } else {
          // Unknown part type — rough estimate from JSON serialization
          tokens += JSON.stringify(part).length / 4;
        }
      }
    }
    return {totalTokens: Math.ceil(tokens)};
  }

  /**
   * Embeddings are not supported.
   */
  async embedContent(_request: unknown): Promise<{embeddings: never[]}> {
    throw new ProviderError('Embeddings are not supported. Use a dedicated embedding service.', {
      provider: this.provider.provider,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async *yieldGoogleChunks(
    fullStream: AsyncIterable<StreamEvent>,
  ): AsyncGenerator<GGenerateContentResponse> {
    for await (const event of fullStream) {
      const chunk = this.streamEventToGoogleChunk(event);
      if (chunk) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural match to upstream GenerateContentResponse class
        yield chunk as unknown as GGenerateContentResponse;
      }
    }
  }

  private streamEventToGoogleChunk(event: StreamEvent): GGenerateContentResponse | null {
    switch (event.type) {
      case 'text-delta':
        return makeChunk([{text: event.textDelta}]);

      case 'tool-call':
        return makeChunk([{
          functionCall: {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
          },
        }]);

      case 'tool-result':
        // Tool results are fed back to the model by the upstream loop,
        // not emitted as response chunks.
        return null;

      case 'finish':
        return makeChunk(
          [],
          'STOP',
          usageToGoogleMetadata(event.usage),
        );

      case 'error':
        throw new ProviderError(`LLM stream error: ${String(event.error)}`, {
          provider: this.provider.provider,
          cause: event.error instanceof Error ? event.error : undefined,
        });

      default:
        return null;
    }
  }
}
