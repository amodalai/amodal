/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export class EvalProviderError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(
    message: string,
    options: {provider: string; model: string; cause?: unknown},
  ) {
    super(message, {cause: options.cause});
    this.name = 'EvalProviderError';
    this.provider = options.provider;
    this.model = options.model;
  }
}
