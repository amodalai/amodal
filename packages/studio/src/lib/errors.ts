/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Base studio error
// ---------------------------------------------------------------------------

/**
 * Base error class for all Studio errors.
 * Follows the same pattern as AmodalError in the runtime package.
 */
export class StudioError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'StudioError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      ...(this.cause instanceof Error
        ? { cause: { name: this.cause.name, message: this.cause.message } }
        : this.cause !== undefined
          ? { cause: String(this.cause) }
          : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Storage errors
// ---------------------------------------------------------------------------

/**
 * Error from the draft storage backend (Postgres).
 */
export class StudioStorageError extends StudioError {
  readonly operation: string;

  constructor(
    message: string,
    options: {
      operation: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('STUDIO_STORAGE_ERROR', message, 500, {
      operation: options.operation,
      ...options.context,
    }, options.cause);
    this.name = 'StudioStorageError';
    this.operation = options.operation;
  }
}

// ---------------------------------------------------------------------------
// Publish errors
// ---------------------------------------------------------------------------

/**
 * Error during the publish operation (writing to disk or committing via GitHub).
 */
export class StudioPublishError extends StudioError {
  constructor(
    message: string,
    options: {
      cause?: unknown;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super('STUDIO_PUBLISH_ERROR', message, 500, options.context ?? {}, options.cause);
    this.name = 'StudioPublishError';
  }
}

// ---------------------------------------------------------------------------
// Path validation errors
// ---------------------------------------------------------------------------

/**
 * Error when a draft file path fails validation.
 */
export class StudioPathError extends StudioError {
  readonly filePath: string;

  constructor(
    message: string,
    options: {
      filePath: string;
    },
  ) {
    super('STUDIO_PATH_ERROR', message, 400, { filePath: options.filePath });
    this.name = 'StudioPathError';
    this.filePath = options.filePath;
  }
}

// ---------------------------------------------------------------------------
// Feature unavailable
// ---------------------------------------------------------------------------

/**
 * Error when a feature is not available in the current environment.
 * Maps to HTTP 501 Not Implemented.
 */
export class StudioFeatureUnavailableError extends StudioError {
  readonly feature: string;

  constructor(feature: string, message?: string) {
    super(
      'STUDIO_FEATURE_UNAVAILABLE',
      message ?? `Feature '${feature}' is not available in this environment`,
      501,
      { feature },
    );
    this.name = 'StudioFeatureUnavailableError';
    this.feature = feature;
  }
}
