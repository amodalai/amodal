/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Typed error classes for Studio backends.
 *
 * Per the repo engineering standards, implementations must raise typed errors
 * at their module boundary rather than bare `new Error(...)`. Callers (the
 * Studio API routes in PR 2.4) can pattern-match on these to produce useful
 * HTTP responses.
 */

/** Base class for every error raised by a `StudioBackend` implementation. */
export class StudioError extends Error {
  override readonly cause: unknown;

  constructor(message: string, options?: {cause?: unknown}) {
    super(message);
    this.name = 'StudioError';
    this.cause = options?.cause;
  }
}

/**
 * Raised when a query against the underlying datastore fails in an unexpected
 * way (connection dropped, malformed row, etc.). Carries the failing operation
 * name and the original error as `cause`.
 */
export class StudioStorageError extends StudioError {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(
      `Studio storage operation '${operation}' failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      {cause},
    );
    this.name = 'StudioStorageError';
    this.operation = operation;
  }
}

/**
 * Raised by `publish()` when writing one or more draft files to the local
 * repository filesystem fails. The drafts are left untouched so the user can
 * retry (per the interface contract).
 */
export class StudioPublishError extends StudioError {
  readonly filePath: string | undefined;

  constructor(message: string, options: {cause?: unknown; filePath?: string} = {}) {
    super(message, {cause: options.cause});
    this.name = 'StudioPublishError';
    this.filePath = options.filePath;
  }
}

/**
 * Raised when a backend feature is intentionally not wired up in the current
 * PR but will land later. Distinct from `StudioNotImplementedError` (which is
 * thrown by the placeholder backend exported from `backend.ts`); this one is
 * thrown from a real implementation that has stubs for a specific method.
 */
export class StudioFeatureUnavailableError extends StudioError {
  readonly feature: string;

  constructor(feature: string, reason: string) {
    super(`Studio feature '${feature}' is not available: ${reason}`);
    this.name = 'StudioFeatureUnavailableError';
    this.feature = feature;
  }
}
