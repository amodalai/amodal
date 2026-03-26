/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Base error for provider failures.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      provider: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, {cause: options.cause});
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Thrown on 429 rate limit responses.
 */
export class RateLimitError extends ProviderError {
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      provider: string;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, {
      provider: options.provider,
      statusCode: 429,
      retryable: true,
      cause: options.cause,
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Thrown when a request times out.
 */
export class ProviderTimeoutError extends ProviderError {
  constructor(
    message: string,
    options: {
      provider: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      provider: options.provider,
      retryable: true,
      cause: options.cause,
    });
    this.name = 'ProviderTimeoutError';
  }
}
