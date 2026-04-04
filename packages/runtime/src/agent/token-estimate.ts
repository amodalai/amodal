/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Rough token estimation from message arrays.
 *
 * Uses a ~4 chars per token heuristic (JSON serialized). This is a
 * placeholder — a future improvement would use the provider's tokenizer
 * or a local tiktoken instance for accurate counts.
 */

import type {ModelMessage} from 'ai';

/**
 * Rough token estimate from a message array. ~4 chars per token.
 */
export function estimateTokenCount(messages: ModelMessage[]): number {
  const serialized = JSON.stringify(messages);
  return Math.ceil(serialized.length / 4);
}
