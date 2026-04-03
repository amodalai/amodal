/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A ContentGenerator implementation that delegates to our existing
 * RuntimeProvider implementations (Anthropic, OpenAI, Bedrock, Azure, etc.)
 *
 * This bridges the upstream gemini-cli-core's ContentGenerator interface
 * (which uses @google/genai types) with our provider-neutral RuntimeProvider
 * system. The upstream GeminiClient calls this instead of the Gemini API,
 * so all its orchestration logic (compression, loop detection, hooks,
 * tool execution) continues to work with any LLM provider.
 */

import type { ModelConfig } from '../../repo/config-schema.js';
import type { RuntimeProvider, LLMChatRequest } from '../runtime/runtime-provider-types.js';
import { createRuntimeProvider } from '../runtime/provider-factory.js';
import { FailoverProvider } from '../runtime/failover-provider.js';
import {
  convertGenerateContentParams,
  normalizeContents,
  type GGenerateContentParams,
} from './google-to-llm.js';
import {
  convertLLMResponse,
  convertStreamEvent,
  type GGenerateContentResponse,
} from './llm-to-google.js';
import { log } from '../../logger.js';

/**
 * ContentGenerator that routes LLM calls through our RuntimeProvider system.
 *
 * Implements the upstream ContentGenerator interface structurally — the
 * actual type comes from @google/gemini-cli-core which we don't import
 * directly. The upstream Config accepts any object matching the interface.
 */
export class MultiProviderContentGenerator {
  private readonly provider: RuntimeProvider;

  constructor(modelConfig: ModelConfig) {
    if (modelConfig.fallback) {
      this.provider = new FailoverProvider(modelConfig);
    } else {
      this.provider = createRuntimeProvider(modelConfig);
    }
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
    log.debug(`generateContent: ${String(llmRequest.tools.length)} tools, ${String(llmRequest.messages.length)} messages`, 'llm');
    log.debug(`Full LLM request:\n${JSON.stringify({model: llmRequest.model, systemPrompt: llmRequest.systemPrompt, messages: llmRequest.messages, tools: llmRequest.tools, maxTokens: llmRequest.maxTokens}, null, 2)}`, 'llm');
    const llmResponse = await this.provider.chat(llmRequest);
    log.debug(`response stopReason=${llmResponse.stopReason}, blocks=${String(llmResponse.content.length)}, types=${llmResponse.content.map(b => b.type).join(',')}`, 'llm');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural match to GenerateContentResponse class
    return convertLLMResponse(llmResponse) as unknown as GGenerateContentResponse;
  }

  /**
   * Streaming content generation.
   *
   * Returns an async generator that yields GenerateContentResponse chunks
   * as our RuntimeProvider streams events.
   */
  async generateContentStream(
    request: GGenerateContentParams,
    _userPromptId: string,
    _role: unknown,
  ): Promise<AsyncGenerator<GGenerateContentResponse>> {
    const llmRequest = convertGenerateContentParams(request);
    log.debug(`generateContentStream: ${String(llmRequest.tools.length)} tools, ${String(llmRequest.messages.length)} messages`, 'llm');
    log.debug(`Full LLM request:\n${JSON.stringify({model: llmRequest.model, systemPrompt: llmRequest.systemPrompt, messages: llmRequest.messages, tools: llmRequest.tools, maxTokens: llmRequest.maxTokens}, null, 2)}`, 'llm');

    if (this.provider.chatStream) {
      return this.streamFromProvider(llmRequest);
    }

    // Fallback: non-streaming chat, emit as single chunk
    return this.fakeStream(llmRequest);
  }

  /**
   * Estimate token count based on character length.
   *
   * Provider-specific tokenizers could be added later; for now a rough
   * estimate (chars / 4) is sufficient since this is only used for
   * context window overflow checks.
   */
  async countTokens(
    request: { contents: unknown; model?: string },
  ): Promise<{ totalTokens: number }> {
    const contents = normalizeContents(request.contents);
    let charCount = 0;
    for (const content of contents) {
      for (const part of content.parts ?? []) {
        if (typeof part.text === 'string') {
          charCount += part.text.length;
        }
      }
    }
    const estimatedTokens = Math.ceil(charCount / 4);
    return { totalTokens: estimatedTokens };
  }

  /**
   * Embeddings are not supported for non-Google providers.
   */
  async embedContent(
    _request: unknown,
  ): Promise<{ embeddings: never[] }> {
    throw new Error(
      'Embeddings are not supported for non-Google providers. ' +
      'Use a Google model or a dedicated embedding service.',
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async *streamFromProvider(
    request: LLMChatRequest,
  ): AsyncGenerator<GGenerateContentResponse> {
    // Track tool names from tool_use_start events so we can patch them
    // into the complete functionCall emitted on tool_use_end.
    const toolNameMap = new Map<string, string>();

    // chatStream is guaranteed non-null by caller check
     
    for await (const event of this.provider.chatStream!(request)) {
      log.debug(`stream event: ${event.type}${event.type === 'tool_use_start' ? ` name=${event.name}` : ''}${event.type === 'tool_use_end' ? ` id=${event.id}` : ''}`, 'llm');

      // Track tool names
      if (event.type === 'tool_use_start') {
        toolNameMap.set(event.id, event.name);
      }

      const chunk = convertStreamEvent(event);
      if (chunk) {
        // Patch the tool name into tool_use_end chunks
        if (event.type === 'tool_use_end') {
          const name = toolNameMap.get(event.id) ?? '';
          const candidate = chunk.candidates?.[0];
          const part = candidate?.content?.parts?.[0];
          if (part?.functionCall) {
            part.functionCall.name = name;
          }
          toolNameMap.delete(event.id);
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural match
        yield chunk as unknown as GGenerateContentResponse;
      }
    }
  }

  private async *fakeStream(
    request: LLMChatRequest,
  ): AsyncGenerator<GGenerateContentResponse> {
    const response = await this.provider.chat(request);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural match
    yield convertLLMResponse(response) as unknown as GGenerateContentResponse;
  }
}
