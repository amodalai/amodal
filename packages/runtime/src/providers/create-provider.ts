/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Factory for creating LLMProvider instances from config.
 *
 * Maps our ProviderConfig (from amodal.json) to the correct Vercel AI SDK
 * provider adapter. OpenAI-compatible providers (DeepSeek, Groq, Mistral,
 * xAI, etc.) reuse the OpenAI adapter with a custom baseURL.
 */

import type {LanguageModel, LanguageModelUsage} from 'ai';
import {streamText, generateText} from 'ai';
import {createAnthropic} from '@ai-sdk/anthropic';
import {createOpenAI} from '@ai-sdk/openai';
import {createGoogleGenerativeAI} from '@ai-sdk/google';

import {ConfigError} from '../errors.js';

/** Default timeout for LLM calls when no AbortSignal is provided (2 minutes). */
const DEFAULT_LLM_TIMEOUT_MS = 120_000;
import type {
  LLMProvider,
  ProviderConfig,
  StreamTextOptions,
  StreamTextResult,
  GenerateTextOptions,
  GenerateTextResult,
  TokenUsage,
  StreamEvent,
} from './types.js';

// ---------------------------------------------------------------------------
// OpenAI-compatible provider base URLs (single source of truth in core)
// ---------------------------------------------------------------------------

import {OPENAI_COMPATIBLE_BASE_URLS} from '@amodalai/core';

// ---------------------------------------------------------------------------
// createLanguageModel — resolve config to an AI SDK LanguageModel
// ---------------------------------------------------------------------------

function createLanguageModel(config: ProviderConfig): LanguageModel {
  const {provider, model, apiKey, baseUrl} = config;

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
        ...(baseUrl ? {baseURL: baseUrl} : {}),
      });
      return anthropic(model);
    }

    case 'openai': {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? {baseURL: baseUrl} : {}),
      });
      return openai(model);
    }

    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(baseUrl ? {baseURL: baseUrl} : {}),
      });
      return google(model);
    }

    default: {
      // OpenAI-compatible providers (DeepSeek, Groq, Mistral, xAI, etc.)
      const compatBaseUrl = baseUrl ?? OPENAI_COMPATIBLE_BASE_URLS[provider];
      if (!compatBaseUrl) {
        throw new ConfigError(`Unknown provider "${provider}". Use a known provider (anthropic, openai, google) or set a baseUrl for OpenAI-compatible providers.`, {
          key: 'providers',
          context: {provider, model},
        });
      }

      const openai = createOpenAI({
        apiKey,
        baseURL: compatBaseUrl,
      });
      return openai(model);
    }
  }
}

// ---------------------------------------------------------------------------
// normalizeUsage — map AI SDK LanguageModelUsage to our TokenUsage
// ---------------------------------------------------------------------------

function normalizeUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? undefined,
    cacheCreationInputTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? undefined,
    totalTokens: usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  };
}

// ---------------------------------------------------------------------------
// createProvider — public factory
// ---------------------------------------------------------------------------

/**
 * Create an LLMProvider from a ProviderConfig.
 *
 * @example
 * ```ts
 * const provider = createProvider({
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-20250514',
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * const result = provider.streamText({
 *   messages: [{role: 'user', content: [{type: 'text', text: 'Hello'}]}],
 * });
 * ```
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  const languageModel = createLanguageModel(config);

  return {
    model: config.model,
    provider: config.provider,
    languageModel,

    streamText(opts: StreamTextOptions): StreamTextResult {
      const sdkResult = streamText({
        model: languageModel,
        messages: opts.messages,
        system: opts.system,
        tools: opts.tools,
        toolChoice: opts.toolChoice,
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        abortSignal: opts.abortSignal ?? AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS),
      });

      const usagePromise = sdkResult.usage.then((u) => normalizeUsage(u));
      const textPromise = sdkResult.text;

      return {
        textStream: sdkResult.textStream,

        fullStream: (async function* (): AsyncGenerator<StreamEvent> {
          for await (const chunk of sdkResult.fullStream) {
            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- intentionally ignoring SDK-internal chunk types (reasoning, source, raw, etc.)
            switch (chunk.type) {
              case 'text-delta':
                yield {type: 'text-delta', textDelta: chunk.text};
                break;
              case 'tool-call':
                yield {
                  type: 'tool-call',
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AI SDK boundary: input is tool params from provider
                  args: (chunk.input ?? {}) as Record<string, unknown>,
                };
                break;
              case 'tool-result':
                yield {
                  type: 'tool-result',
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  result: chunk.output,
                };
                break;
              case 'finish':
                yield {type: 'finish', usage: normalizeUsage(chunk.totalUsage)};
                break;
              case 'error':
                yield {type: 'error', error: chunk.error};
                break;
              default:
                // Ignore other chunk types (step-start, step-finish, reasoning, source, etc.)
                break;
            }
          }
        })(),

        usage: usagePromise,
        text: textPromise,
        responseMessages: sdkResult.response.then((r) => r.messages),
      };
    },

    async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
      const result = await generateText({
        model: languageModel,
        messages: opts.messages,
        system: opts.system,
        tools: opts.tools,
        toolChoice: opts.toolChoice,
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        abortSignal: opts.abortSignal ?? AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS),
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls.map((tc) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AI SDK boundary: input is tool params from provider
          args: (tc.input ?? {}) as Record<string, unknown>,
        })),
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason,
      };
    },
  };
}
