/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider failover chain.
 *
 * Tries each provider in sequence. On failure, logs the error and moves
 * to the next provider. No retries or backoff within a single provider —
 * the chain itself IS the retry strategy. If you want retries on the
 * primary, put the same provider config twice in the chain.
 *
 * All providers exhausted → throws ProviderError with context about
 * every attempt.
 */

import type {Logger} from '@amodalai/core';
import type {
  LLMProvider,
  ProviderConfig,
  StreamTextOptions,
  StreamTextResult,
  GenerateTextOptions,
  GenerateTextResult,
  StreamEvent,
  TokenUsage,
} from './types.js';
import {createProvider} from './create-provider.js';
import {ProviderError} from '../errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FailoverChainConfig {
  /** Primary provider (always first in the chain) */
  primary: ProviderConfig;
  /** Fallback providers, tried in order after primary fails */
  fallbacks?: ProviderConfig[];
  /** Logger for structured events */
  logger: Logger;
  /** Session ID for log context */
  sessionId?: string;
}

interface FailedAttempt {
  provider: string;
  model: string;
  error: string;
}

// ---------------------------------------------------------------------------
// createFailoverProvider
// ---------------------------------------------------------------------------

/**
 * Create an LLMProvider that tries a chain of providers in order.
 *
 * For generateText: tries each provider sequentially until one succeeds.
 * For streamText: wraps the fullStream so that if a provider's stream
 * fails before yielding any events, the next provider is tried. Once
 * events have been yielded, mid-stream errors propagate (can't restart
 * a partial stream).
 */
export function createFailoverProvider(config: FailoverChainConfig): LLMProvider {
  const chain = [config.primary, ...(config.fallbacks ?? [])];
  const providers: LLMProvider[] = chain.map((c) => createProvider(c));
  const primary = providers[0];

  function logFailure(idx: number, errorMsg: string, failedAttempts: FailedAttempt[]): void {
    failedAttempts.push({
      provider: chain[idx].provider,
      model: chain[idx].model,
      error: errorMsg,
    });

    config.logger.error('provider_call_failed', {
      session: config.sessionId,
      provider: `${chain[idx].provider}/${chain[idx].model}`,
      error: errorMsg,
      willRetry: idx < providers.length - 1,
    });
  }

  function logSuccess(idx: number, failedAttempts: FailedAttempt[]): void {
    if (idx > 0) {
      config.logger.warn('provider_failover_used', {
        session: config.sessionId,
        failed: failedAttempts.map((a) => `${a.provider}/${a.model}`),
        succeeded: `${chain[idx].provider}/${chain[idx].model}`,
      });
    }
  }

  function throwAllFailed(failedAttempts: FailedAttempt[], cause: unknown): never {
    throw new ProviderError('All providers failed', {
      provider: 'failover',
      context: {attempts: failedAttempts},
      cause,
    });
  }

  return {
    model: primary.model,
    provider: primary.provider,
    languageModel: primary.languageModel,

    streamText(opts: StreamTextOptions): StreamTextResult {
      // Deferred promises for usage and text — resolved when stream completes.
      let resolveUsage!: (u: TokenUsage) => void;
      let rejectUsage!: (e: unknown) => void;
      const usagePromise = new Promise<TokenUsage>((res, rej) => {
        resolveUsage = res;
        rejectUsage = rej;
      });

      let resolveText!: (t: string) => void;
      let rejectText!: (e: unknown) => void;
      const textPromise = new Promise<string>((res, rej) => {
        resolveText = res;
        rejectText = rej;
      });

      const failedAttempts: FailedAttempt[] = [];

      const fullStream = (async function* (): AsyncGenerator<StreamEvent> {
        let lastUsage: TokenUsage | undefined;
        const textChunks: string[] = [];

        for (let i = 0; i < providers.length; i++) {
          let yieldedAny = false;
          try {
            const result = providers[i].streamText(opts);
            for await (const event of result.fullStream) {
              yieldedAny = true;
              if (event.type === 'finish') lastUsage = event.usage;
              if (event.type === 'text-delta') textChunks.push(event.textDelta);
              yield event;
            }

            // Stream completed successfully
            logSuccess(i, failedAttempts);
            resolveUsage(lastUsage ?? {inputTokens: 0, outputTokens: 0, totalTokens: 0});
            resolveText(textChunks.join(''));
            return;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);

            // If we already yielded events, we can't retry — log and propagate
            if (yieldedAny) {
              logFailure(i, errorMsg, failedAttempts);
              rejectUsage(err);
              rejectText(err);
              throw err;
            }

            logFailure(i, errorMsg, failedAttempts);

            if (i === providers.length - 1) {
              rejectUsage(err);
              rejectText(err);
              throwAllFailed(failedAttempts, err);
            }
            // Try next provider
          }
        }
      })();

      return {
        fullStream,
        // textStream derived from fullStream — consumers should use one or the other
        textStream: (async function* () {
          for await (const event of fullStream) {
            if (event.type === 'text-delta') {
              yield event.textDelta;
            }
          }
        })(),
        usage: usagePromise,
        text: textPromise,
      };
    },

    async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
      const failedAttempts: FailedAttempt[] = [];

      for (let i = 0; i < providers.length; i++) {
        try {
          const result = await providers[i].generateText(opts);
          logSuccess(i, failedAttempts);
          return result;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logFailure(i, errorMsg, failedAttempts);

          if (i === providers.length - 1) {
            throwAllFailed(failedAttempts, err);
          }
        }
      }

      // Unreachable — TypeScript needs this
      throw new ProviderError('No providers configured', {provider: 'failover'});
    },
  };
}
