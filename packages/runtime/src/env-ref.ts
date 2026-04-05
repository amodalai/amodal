/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolver for `env:VAR_NAME` config references.
 *
 * amodal.json values can be written as either a literal string or as
 * `env:VAR_NAME` to pull from the process environment. Centralizing
 * resolution here keeps `process.env` reads out of business logic per
 * CLAUDE.md and avoids drift between callers.
 */

const ENV_PREFIX = 'env:';

/**
 * Resolve an optional config value that may be an `env:VAR_NAME` reference.
 *
 * - `undefined` / empty → returns `undefined`.
 * - Plain string → returned unchanged.
 * - `env:FOO` → returns `process.env.FOO` (may be `undefined` if unset).
 */
export function resolveEnvRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith(ENV_PREFIX)) {
    const varName = value.slice(ENV_PREFIX.length);
    return process.env[varName];
  }
  return value;
}
