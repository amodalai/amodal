/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ModelConfig} from '../../repo/config-schema.js';
import type {RuntimeProvider} from './runtime-provider-types.js';
import {ProviderError} from './provider-errors.js';
import {AnthropicRuntimeProvider} from './anthropic-provider.js';
import {OpenAIRuntimeProvider} from './openai-provider.js';
import {GoogleRuntimeProvider} from './google-provider.js';
import {BedrockRuntimeProvider} from './bedrock-provider.js';
import {AzureOpenAIRuntimeProvider} from './azure-provider.js';

/**
 * Creates a RuntimeProvider for the given model config.
 *
 * - `anthropic` → AnthropicRuntimeProvider
 * - `openai` → OpenAIRuntimeProvider
 * - `google` → GoogleRuntimeProvider
 * - `bedrock` → BedrockRuntimeProvider
 * - `azure` → AzureOpenAIRuntimeProvider
 * - Unknown provider with `baseUrl` → OpenAIRuntimeProvider (OpenAI-compatible)
 * - Unknown provider without `baseUrl` → throws
 */
export function createRuntimeProvider(modelConfig: ModelConfig): RuntimeProvider {
  switch (modelConfig.provider) {
    case 'anthropic':
      return new AnthropicRuntimeProvider(modelConfig);
    case 'openai':
      return new OpenAIRuntimeProvider(modelConfig);
    case 'google':
      return new GoogleRuntimeProvider(modelConfig);
    case 'bedrock':
      return new BedrockRuntimeProvider(modelConfig);
    case 'azure':
      return new AzureOpenAIRuntimeProvider(modelConfig);
    case 'deepseek':
      return new OpenAIRuntimeProvider({
        ...modelConfig,
        baseUrl: modelConfig.baseUrl ?? 'https://api.deepseek.com/v1',
        credentials: modelConfig.credentials ?? {OPENAI_API_KEY: process.env['DEEPSEEK_API_KEY'] ?? ''},
      });
    case 'groq':
      return new OpenAIRuntimeProvider({
        ...modelConfig,
        baseUrl: modelConfig.baseUrl ?? 'https://api.groq.com/openai/v1',
        credentials: modelConfig.credentials ?? {OPENAI_API_KEY: process.env['GROQ_API_KEY'] ?? ''},
      });
    case 'mistral':
      return new OpenAIRuntimeProvider({
        ...modelConfig,
        baseUrl: modelConfig.baseUrl ?? 'https://api.mistral.ai/v1',
        credentials: modelConfig.credentials ?? {OPENAI_API_KEY: process.env['MISTRAL_API_KEY'] ?? ''},
      });
    case 'xai':
      return new OpenAIRuntimeProvider({
        ...modelConfig,
        baseUrl: modelConfig.baseUrl ?? 'https://api.x.ai/v1',
        credentials: modelConfig.credentials ?? {OPENAI_API_KEY: process.env['XAI_API_KEY'] ?? ''},
      });
    default:
      if (modelConfig.baseUrl) {
        // OpenAI-compatible endpoint
        return new OpenAIRuntimeProvider(modelConfig);
      }
      throw new ProviderError(`Unsupported provider: ${modelConfig.provider}`, {
        provider: modelConfig.provider,
      });
  }
}
