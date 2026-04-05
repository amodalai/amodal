/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared helpers for the `web_search` and `fetch_url` tools.
 *
 * - `MAX_WEB_TOOL_RESULT_TOKENS` — uniform 2000-token cap on tool output.
 * - `truncateToTokens()` — token-estimate truncation using the 4 chars/token
 *   heuristic (matches `packages/runtime/src/agent/token-estimate.ts`).
 */

/** Max token budget for any single web-tool result, before truncation. */
export const MAX_WEB_TOOL_RESULT_TOKENS = 2000;

/** Chars-per-token approximation — matches `estimateTokenCount()`. */
const CHARS_PER_TOKEN = 4;

/** Suffix appended when content is truncated, so the model knows it is clipped. */
const TRUNCATION_SUFFIX = '\n\n…(truncated)';

/**
 * Truncate a string to fit within `maxTokens` tokens, using the same
 * 4-chars-per-token heuristic the rest of the runtime uses. When the
 * input fits, it is returned unchanged; otherwise it is trimmed and a
 * truncation marker is appended so the model sees that content was cut.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  const roomForSuffix = Math.max(0, maxChars - TRUNCATION_SUFFIX.length);
  return text.slice(0, roomForSuffix) + TRUNCATION_SUFFIX;
}
