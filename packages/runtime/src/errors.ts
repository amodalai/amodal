/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * A discriminated result type for operations that can fail.
 * Forces callers to handle both success and error cases.
 */
export type Result<T, E = Error> =
  | {ok: true; value: T}
  | {ok: false; error: E};

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/**
 * Base error class for all Amodal runtime errors.
 *
 * Every error carries:
 * - `code` — a unique, stable string for programmatic matching
 * - `context` — structured data about what was happening when the error occurred
 * - `cause` — the underlying error (standard Error.cause)
 */
export class AmodalError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, {cause});
    this.name = 'AmodalError';
    this.code = code;
    this.context = context;
  }

  /**
   * Serialize to a structured object suitable for logging or JSON responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      ...(this.cause instanceof Error
        ? {cause: {name: this.cause.name, message: this.cause.message}}
        : this.cause !== undefined
          ? {cause: String(this.cause)}
          : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Provider errors
// ---------------------------------------------------------------------------

/**
 * Error from an LLM provider call (Anthropic, OpenAI, Google, etc.).
 */
export class ProviderError extends AmodalError {
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
      context?: Record<string, unknown>;
    },
  ) {
    super('PROVIDER_ERROR', message, {
      provider: options.provider,
      statusCode: options.statusCode,
      ...options.context,
    }, options.cause);
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
      context: {retryAfterMs: options.retryAfterMs},
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Thrown when a provider request times out.
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

// ---------------------------------------------------------------------------
// Tool errors
// ---------------------------------------------------------------------------

/**
 * Error during tool execution (custom tools, store tools, request tool, etc.).
 */
export class ToolExecutionError extends AmodalError {
  readonly toolName: string;
  readonly callId: string;

  constructor(
    message: string,
    options: {
      toolName: string;
      callId: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('TOOL_EXECUTION_ERROR', message, {
      toolName: options.toolName,
      callId: options.callId,
      ...options.context,
    }, options.cause);
    this.name = 'ToolExecutionError';
    this.toolName = options.toolName;
    this.callId = options.callId;
  }
}

// ---------------------------------------------------------------------------
// Store errors
// ---------------------------------------------------------------------------

/**
 * Error from a store backend operation (PGLite, Postgres, etc.).
 */
export class StoreError extends AmodalError {
  readonly store: string;
  readonly operation: string;

  constructor(
    message: string,
    options: {
      store: string;
      operation: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('STORE_ERROR', message, {
      store: options.store,
      operation: options.operation,
      ...options.context,
    }, options.cause);
    this.name = 'StoreError';
    this.store = options.store;
    this.operation = options.operation;
  }
}

// ---------------------------------------------------------------------------
// Connection errors
// ---------------------------------------------------------------------------

/**
 * Error from a connection request (REST API calls, MCP, etc.).
 */
export class ConnectionError extends AmodalError {
  readonly connection: string;
  readonly action: string;

  constructor(
    message: string,
    options: {
      connection: string;
      action: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('CONNECTION_ERROR', message, {
      connection: options.connection,
      action: options.action,
      ...options.context,
    }, options.cause);
    this.name = 'ConnectionError';
    this.connection = options.connection;
    this.action = options.action;
  }
}

// ---------------------------------------------------------------------------
// Session errors
// ---------------------------------------------------------------------------

/**
 * Error in session lifecycle (creation, destroy, state transitions).
 */
export class SessionError extends AmodalError {
  readonly sessionId: string;

  constructor(
    message: string,
    options: {
      sessionId: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('SESSION_ERROR', message, {
      sessionId: options.sessionId,
      ...options.context,
    }, options.cause);
    this.name = 'SessionError';
    this.sessionId = options.sessionId;
  }
}

// ---------------------------------------------------------------------------
// Compaction errors
// ---------------------------------------------------------------------------

/**
 * Error during context compaction (summarization, truncation).
 */
export class CompactionError extends AmodalError {
  readonly stage: string;

  constructor(
    message: string,
    options: {
      stage: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('COMPACTION_ERROR', message, {
      stage: options.stage,
      ...options.context,
    }, options.cause);
    this.name = 'CompactionError';
    this.stage = options.stage;
  }
}

// ---------------------------------------------------------------------------
// Config errors
// ---------------------------------------------------------------------------

/**
 * Error in configuration loading or validation.
 * Includes a `suggestion` field with actionable fix instructions.
 */
export class ConfigError extends AmodalError {
  readonly key: string;
  readonly suggestion: string;

  constructor(
    message: string,
    options: {
      key: string;
      suggestion?: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('CONFIG_ERROR', message, {
      key: options.key,
      ...options.context,
    }, options.cause);
    this.name = 'ConfigError';
    this.key = options.key;
    this.suggestion = options.suggestion ?? '';
  }

  /** Format as a multi-line error message for CLI output. */
  format(): string {
    const lines = [`Config error: ${this.message}`];
    if (this.key) lines.push(`  Key: ${this.key}`);
    if (this.suggestion) lines.push(`  Fix: ${this.suggestion}`);
    return lines.join('\n');
  }
}
