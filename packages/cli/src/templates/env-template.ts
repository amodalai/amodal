/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

const ENV_PATTERN = /env:([A-Z_][A-Z0-9_]*)/g;

/**
 * Extract all env:VAR_NAME references from JSON config strings.
 *
 * Returns a deduplicated list of environment variable names.
 */
export function extractEnvVars(jsonString: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;

  // Reset regex state
  ENV_PATTERN.lastIndex = 0;
  while ((match = ENV_PATTERN.exec(jsonString)) !== null) {
    if (match[1]) {
      vars.add(match[1]);
    }
  }

  return [...vars].sort();
}
