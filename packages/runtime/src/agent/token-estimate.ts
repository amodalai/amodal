/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Token estimation from message arrays.
 *
 * The runtime's default count is a ~4 chars-per-token heuristic over the
 * JSON-serialized messages — close enough for compaction decisions but
 * not exact. When a provider implements `countTokens` (e.g. wiring a
 * local `tiktoken` for OpenAI/Anthropic), the runtime delegates to it
 * for higher fidelity.
 */

import type {ModelMessage} from 'ai';
import type {LLMProvider} from '../providers/types.js';

/**
 * Estimate tokens for a message array.
 *
 * If `provider.countTokens` is implemented, delegates to it for a
 * provider-native count. Otherwise falls back to the 4-chars-per-token
 * heuristic over the serialized JSON — fine for compaction thresholds,
 * but noticeably off for tool-heavy contexts.
 *
 * Results are memoized by message-array identity (WeakMap). Callers in
 * the agent loop treat `ctx.messages` as immutable — every append creates
 * a new array via spread — so reference equality is a safe cache key.
 * This turns N-per-turn stringify calls into O(1) lookups after the
 * first estimate, which matters on long tool-heavy sessions.
 */
export function estimateTokenCount(
  messages: ModelMessage[],
  provider?: LLMProvider,
): number {
  if (provider?.countTokens) {
    return provider.countTokens(messages);
  }
  const cached = heuristicCache.get(messages);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(messages);
  const estimate = Math.ceil(serialized.length / 4);
  heuristicCache.set(messages, estimate);
  return estimate;
}

/** Identity-keyed cache for the JSON-length heuristic. */
const heuristicCache = new WeakMap<ModelMessage[], number>();
