/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ContextSection} from './runtime-types.js';

const DEFAULT_RESPONSE_RESERVE = 4096;

/**
 * Returns the context window size for a given model string.
 */
export function getModelContextWindow(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes('gemini')) {
    return 1_000_000;
  }
  if (lower.includes('claude')) {
    return 1_000_000;
  }
  if (lower.includes('gpt-4o')) {
    return 128_000;
  }
  return 128_000;
}

/**
 * Allocates token budget across context sections using priority-based trimming.
 *
 * Sections with lower priority numbers are trimmed first when the total
 * exceeds the available budget.
 */
export class TokenAllocator {
  readonly budget: number;

  constructor(
    modelContextWindow: number,
    reserveForResponse: number = DEFAULT_RESPONSE_RESERVE,
  ) {
    this.budget = Math.max(0, modelContextWindow - reserveForResponse);
  }

  /**
   * Estimates the number of tokens in a text string.
   * Uses the chars / 4 heuristic.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Allocates budget to sections, trimming lowest-priority sections first
   * when the total exceeds available budget.
   */
  allocate(sections: ContextSection[]): {
    included: ContextSection[];
    trimmed: ContextSection[];
    totalTokens: number;
  } {
    // Calculate tokens for each section
    const withTokens = sections.map((s) => ({
      ...s,
      tokens: this.estimateTokens(s.content),
    }));

    const totalNeeded = withTokens.reduce((sum, s) => sum + s.tokens, 0);

    // Everything fits
    if (totalNeeded <= this.budget) {
      return {
        included: withTokens.map((s) => ({...s, trimmed: false})),
        trimmed: [],
        totalTokens: totalNeeded,
      };
    }

    // Sort by priority ascending to trim lowest first
    const sortedByPriority = [...withTokens].sort(
      (a, b) => a.priority - b.priority,
    );

    let excess = totalNeeded - this.budget;
    const trimmedNames = new Set<string>();

    for (const section of sortedByPriority) {
      if (excess <= 0) {
        break;
      }
      trimmedNames.add(section.name);
      excess -= section.tokens;
    }

    const included: ContextSection[] = [];
    const trimmed: ContextSection[] = [];
    let totalTokens = 0;

    for (const section of withTokens) {
      if (trimmedNames.has(section.name)) {
        trimmed.push({...section, content: '', tokens: 0, trimmed: true});
      } else {
        included.push({...section, trimmed: false});
        totalTokens += section.tokens;
      }
    }

    return {included, trimmed, totalTokens};
  }
}
