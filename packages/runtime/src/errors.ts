/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Base error class for the Amodal runtime.
 *
 * All errors carry a machine-readable `code` and a structured `context` bag
 * that gets included in log entries. Phase 0.2 will expand this with
 * ProviderError, ToolExecutionError, StoreError, etc.
 */
export class AmodalError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AmodalError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Configuration error — missing keys, invalid values, failed validation.
 * Includes a `suggestion` field with actionable fix instructions.
 */
export class ConfigError extends AmodalError {
  readonly key: string;
  readonly suggestion: string;

  constructor(key: string, message: string, suggestion: string, context: Record<string, unknown> = {}) {
    super('CONFIG_ERROR', message, { key, ...context });
    this.name = 'ConfigError';
    this.key = key;
    this.suggestion = suggestion;
  }

  /** Format as a multi-line error message for CLI output. */
  format(): string {
    const lines = [`Config error: ${this.message}`];
    if (this.key) lines.push(`  Key: ${this.key}`);
    if (this.suggestion) lines.push(`  Fix: ${this.suggestion}`);
    return lines.join('\n');
  }
}
