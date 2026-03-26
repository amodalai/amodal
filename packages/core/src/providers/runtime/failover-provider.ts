/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ModelConfig} from '../../repo/config-schema.js';
import type {
  RuntimeProvider,
  LLMChatRequest,
  LLMChatResponse,
} from './runtime-provider-types.js';
import type {LLMStreamEvent} from './streaming-types.js';
import {ProviderError} from './provider-errors.js';
import {createRuntimeProvider} from './provider-factory.js';

export interface FailoverOptions {
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

/**
 * Wraps a primary provider with retry logic and optional fallback.
 *
 * Retry strategy:
 * 1. Try primary up to `maxRetries` times on retryable errors (429, 5xx, timeout)
 * 2. Non-retryable errors (4xx except 429, auth) fail immediately
 * 3. After retries exhausted, try fallback provider (from ModelConfig.fallback)
 * 4. Both fail → throw last error
 * 5. Linear backoff: 1s, 2s, 3s between retries
 * 6. Abort signal cancels the retry loop
 */
export class FailoverProvider implements RuntimeProvider {
  private readonly primary: RuntimeProvider;
  private readonly fallback: RuntimeProvider | undefined;
  private readonly maxRetries: number;

  constructor(modelConfig: ModelConfig, options?: FailoverOptions) {
    this.primary = createRuntimeProvider(modelConfig);
    this.fallback = modelConfig.fallback
      ? createRuntimeProvider(modelConfig.fallback)
      : undefined;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    let lastError: ProviderError | undefined;

    // Try primary with retries
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (request.signal?.aborted) {
        throw new ProviderError('Request aborted', {provider: 'failover', retryable: false});
      }

      try {
        return await this.primary.chat(request);
      } catch (err) {
        lastError = err instanceof ProviderError
          ? err
          : new ProviderError(String(err), {provider: 'unknown', cause: err});

        // Non-retryable errors skip remaining retries
        if (!lastError.retryable) {
          break;
        }

        // Don't delay after the last retry attempt
        if (attempt < this.maxRetries) {
          const delayMs = BASE_DELAY_MS * (attempt + 1);
          await delay(delayMs, request.signal);
        }
      }
    }

    // Try fallback
    if (this.fallback) {
      if (request.signal?.aborted) {
        throw new ProviderError('Request aborted', {provider: 'failover', retryable: false});
      }

      try {
        return await this.fallback.chat(request);
      } catch (err) {
        lastError = err instanceof ProviderError
          ? err
          : new ProviderError(String(err), {provider: 'unknown', cause: err});
      }
    }

    throw lastError ?? new ProviderError('All providers failed', {provider: 'failover'});
  }

  async *chatStream(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent> {
    // Try primary stream
    if (this.primary.chatStream) {
      try {
        yield* this.primary.chatStream(request);
        return;
      } catch (err) {
        // Fall through to fallback
        if (!this.fallback?.chatStream) {
          throw err;
        }
      }
    }

    // Try fallback stream
    if (this.fallback?.chatStream) {
      yield* this.fallback.chatStream(request);
      return;
    }

    // Neither supports streaming — fall back to non-streaming chat
    const response = await this.chat(request);
    for (const block of response.content) {
      if (block.type === 'text') {
        yield {type: 'text_delta', text: block.text};
      } else if (block.type === 'tool_use') {
        yield {type: 'tool_use_start', id: block.id, name: block.name};
        yield {type: 'tool_use_delta', id: block.id, inputDelta: JSON.stringify(block.input)};
        yield {type: 'tool_use_end', id: block.id, input: block.input};
      }
    }
    yield {
      type: 'message_end',
      stopReason: response.stopReason,
      usage: response.usage,
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('Request aborted', {provider: 'failover', retryable: false}));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ProviderError('Request aborted', {provider: 'failover', retryable: false}));
      },
      {once: true},
    );
  });
}
