/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LanguageModel} from 'ai';
import {generateText} from 'ai';
import {createAnthropic} from '@ai-sdk/anthropic';
import {createOpenAI} from '@ai-sdk/openai';
import {createGoogleGenerativeAI} from '@ai-sdk/google';

import type {EvalQueryProvider} from './eval-runner.js';
import type {ModelConfig} from '../repo/config-schema.js';

const DEFAULT_LLM_TIMEOUT_MS = 120_000;

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  together: 'https://api.together.xyz/v1',
};

function resolveApiKey(config: ModelConfig): string | undefined {
  if (!config.credentials) return undefined;
  return config.credentials['apiKey'] ?? config.credentials['api_key'];
}

function createLanguageModel(config: ModelConfig): LanguageModel {
  const {provider, model, baseUrl} = config;
  const apiKey = resolveApiKey(config);

  switch (provider) {
    case 'anthropic':
      return createAnthropic({apiKey, ...(baseUrl ? {baseURL: baseUrl} : {})})(model);

    case 'openai':
      return createOpenAI({apiKey, ...(baseUrl ? {baseURL: baseUrl} : {})})(model);

    case 'google':
      return createGoogleGenerativeAI({apiKey, ...(baseUrl ? {baseURL: baseUrl} : {})})(model);

    default: {
      const compatBaseUrl = baseUrl ?? OPENAI_COMPATIBLE_BASE_URLS[provider];
      if (!compatBaseUrl) {
        throw new Error(
          `Unknown provider "${provider}". Use a known provider (anthropic, openai, google) or set a baseUrl for OpenAI-compatible providers.`,
        );
      }
      return createOpenAI({apiKey, baseURL: compatBaseUrl})(model);
    }
  }
}

export interface SessionEvalProviderOptions {
  modelConfig: ModelConfig;
  systemPrompt?: string;
  maxTokens?: number;
}

export class SessionEvalQueryProvider implements EvalQueryProvider {
  private readonly languageModel: LanguageModel;
  private readonly systemPrompt: string;
  private readonly maxTokens: number;

  constructor(options: SessionEvalProviderOptions) {
    this.languageModel = createLanguageModel(options.modelConfig);
    this.systemPrompt = options.systemPrompt ?? 'You are a helpful assistant.';
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async query(
    message: string,
    _appId?: string,
  ): Promise<{
    response: string;
    toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
    usage?: {inputTokens: number; outputTokens: number};
  }> {
    const result = await generateText({
      model: this.languageModel,
      system: this.systemPrompt,
      messages: [{role: 'user', content: message}],
      maxOutputTokens: this.maxTokens,
      abortSignal: AbortSignal.timeout(DEFAULT_LLM_TIMEOUT_MS),
    });

    const toolCalls = result.toolCalls.map((tc) => ({
      name: tc.toolName,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AI SDK boundary
      parameters: (tc.input ?? {}) as Record<string, unknown>,
    }));

    const inputTokens = result.usage?.inputTokens;
    const outputTokens = result.usage?.outputTokens;

    return {
      response: result.text,
      toolCalls,
      usage:
        inputTokens != null && outputTokens != null
          ? {inputTokens, outputTokens}
          : undefined,
    };
  }
}
