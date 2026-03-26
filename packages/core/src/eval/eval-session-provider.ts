/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalQueryProvider} from './eval-runner.js';
import type {ModelConfig} from '../repo/config-schema.js';
import type {RuntimeProvider, LLMToolDefinition} from '../providers/runtime/runtime-provider-types.js';
import {createRuntimeProvider} from '../providers/runtime/provider-factory.js';

/**
 * Options for creating a SessionEvalQueryProvider.
 */
export interface SessionEvalProviderOptions {
  modelConfig: ModelConfig;
  systemPrompt?: string;
  tools?: LLMToolDefinition[];
  maxTokens?: number;
}

/**
 * An EvalQueryProvider that uses the runtime provider infrastructure.
 * Creates an ephemeral LLM call for each query, capturing token usage.
 */
export class SessionEvalQueryProvider implements EvalQueryProvider {
  private readonly provider: RuntimeProvider;
  private readonly systemPrompt: string;
  private readonly tools: LLMToolDefinition[];
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: SessionEvalProviderOptions) {
    this.provider = createRuntimeProvider(options.modelConfig);
    this.systemPrompt = options.systemPrompt ?? 'You are a helpful assistant.';
    this.tools = options.tools ?? [];
    this.model = options.modelConfig.model;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async query(
    message: string,
    _tenantId?: string,
  ): Promise<{
    response: string;
    toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
    usage?: {inputTokens: number; outputTokens: number};
  }> {
    const result = await this.provider.chat({
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: [{role: 'user', content: message}],
      tools: this.tools,
      maxTokens: this.maxTokens,
    });

    const responseText = result.content
      .filter((b): b is {type: 'text'; text: string} => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls = result.content
      .filter((b): b is {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>} => b.type === 'tool_use')
      .map((b) => ({name: b.name, parameters: b.input}));

    return {
      response: responseText,
      toolCalls,
      usage: result.usage,
    };
  }
}
