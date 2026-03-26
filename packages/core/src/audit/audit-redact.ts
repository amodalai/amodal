/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Patterns that match sensitive parameter key names.
 * Case-insensitive matching is applied when checking.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /\bauth\b/i,
  /credential/i,
  /bearer/i,
  /authorization/i,
];

const REDACTED = '[REDACTED]';

/**
 * Checks whether a single key name matches any sensitive pattern.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Deep-clones a params object and replaces values of sensitive keys
 * with "[REDACTED]". Returns a new object — the original is not mutated.
 */
export function redactSensitiveParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return redactObject(params);
}

function redactObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (isPlainObject(value)) {
      result[key] = redactObject(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) ? redactObject(item) : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
