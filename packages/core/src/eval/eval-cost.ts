/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalCostInfo} from './eval-types.js';

/**
 * Pricing per million tokens (in microdollars) for known models.
 * Prices are approximate and should be updated as providers change pricing.
 */
export interface ModelPricing {
  inputPerMToken: number;
  outputPerMToken: number;
  /** Price per million tokens for cache reads. Defaults to 10% of inputPerMToken. */
  cacheReadPerMToken?: number;
  /** Price per million tokens for cache writes. Defaults to 125% of inputPerMToken. */
  cacheWritePerMToken?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic — cache read = 10% of input, cache write = 125% of input
  'claude-opus-4-20250514': {inputPerMToken: 15_000_000, outputPerMToken: 75_000_000, cacheReadPerMToken: 1_500_000, cacheWritePerMToken: 18_750_000},
  'claude-sonnet-4-20250514': {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000, cacheReadPerMToken: 300_000, cacheWritePerMToken: 3_750_000},
  'claude-sonnet-4-6-20250626': {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000, cacheReadPerMToken: 300_000, cacheWritePerMToken: 3_750_000},
  'claude-haiku-3-5-20241022': {inputPerMToken: 800_000, outputPerMToken: 4_000_000, cacheReadPerMToken: 80_000, cacheWritePerMToken: 1_000_000},
  'claude-haiku-4-5-20251001': {inputPerMToken: 800_000, outputPerMToken: 4_000_000, cacheReadPerMToken: 80_000, cacheWritePerMToken: 1_000_000},
  // OpenAI
  'gpt-4o': {inputPerMToken: 2_500_000, outputPerMToken: 10_000_000},
  'gpt-4o-mini': {inputPerMToken: 150_000, outputPerMToken: 600_000},
  'gpt-4.1': {inputPerMToken: 2_000_000, outputPerMToken: 8_000_000},
  'gpt-4.1-mini': {inputPerMToken: 400_000, outputPerMToken: 1_600_000},
  'gpt-4.1-nano': {inputPerMToken: 100_000, outputPerMToken: 400_000},
  // Google
  'gemini-2.5-pro': {inputPerMToken: 1_250_000, outputPerMToken: 10_000_000},
  'gemini-2.5-flash': {inputPerMToken: 150_000, outputPerMToken: 600_000},
  'gemini-2.0-flash': {inputPerMToken: 100_000, outputPerMToken: 400_000},
  // DeepSeek
  'deepseek-chat': {inputPerMToken: 270_000, outputPerMToken: 1_100_000},
  'deepseek-reasoner': {inputPerMToken: 550_000, outputPerMToken: 2_190_000},
  // Groq (hosted models)
  'llama-3.3-70b-versatile': {inputPerMToken: 590_000, outputPerMToken: 790_000},
  'llama-3.1-8b-instant': {inputPerMToken: 50_000, outputPerMToken: 80_000},
  'mixtral-8x7b-32768': {inputPerMToken: 240_000, outputPerMToken: 240_000},
};

// Default pricing for unknown models (conservative estimate)
const DEFAULT_PRICING: ModelPricing = {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000};

/**
 * Look up pricing for a model, falling back to default for unknown models.
 */
export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/**
 * Compute cost info from token counts and model identity.
 *
 * When `cacheReadInputTokens` or `cacheCreationInputTokens` are provided the
 * cost is computed using the cache-specific pricing and the hypothetical
 * no-cache cost is included for comparison.
 */
export function computeEvalCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
  cacheReadInputTokens?: number,
  cacheCreationInputTokens?: number,
): EvalCostInfo {
  const pricing = getModelPricing(model);
  const cacheRead = cacheReadInputTokens ?? 0;
  const cacheWrite = cacheCreationInputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens + cacheRead + cacheWrite;

  const cacheReadPrice = pricing.cacheReadPerMToken ?? Math.round(pricing.inputPerMToken * 0.1);
  const cacheWritePrice = pricing.cacheWritePerMToken ?? Math.round(pricing.inputPerMToken * 1.25);

  const estimatedCostMicros = Math.round(
    (inputTokens * pricing.inputPerMToken
      + cacheRead * cacheReadPrice
      + cacheWrite * cacheWritePrice
      + outputTokens * pricing.outputPerMToken) / 1_000_000,
  );

  // Hypothetical cost: treat all cached tokens as regular input
  const allInputTokens = inputTokens + cacheRead + cacheWrite;
  const estimatedCostNoCacheMicros = Math.round(
    (allInputTokens * pricing.inputPerMToken + outputTokens * pricing.outputPerMToken) / 1_000_000,
  );

  const hasCacheData = cacheRead > 0 || cacheWrite > 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(hasCacheData ? {cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheWrite} : {}),
    estimatedCostMicros,
    ...(hasCacheData ? {estimatedCostNoCacheMicros} : {}),
  };
}

/**
 * Aggregate multiple per-case costs into a total.
 */
export function aggregateRunCost(perCaseCosts: EvalCostInfo[]): EvalCostInfo {
  const result: EvalCostInfo = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostMicros: 0,
  };

  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalNoCacheMicros = 0;
  let hasCacheData = false;

  for (const cost of perCaseCosts) {
    result.inputTokens += cost.inputTokens;
    result.outputTokens += cost.outputTokens;
    result.totalTokens += cost.totalTokens;
    result.estimatedCostMicros += cost.estimatedCostMicros;
    if (cost.cacheReadInputTokens || cost.cacheCreationInputTokens) {
      hasCacheData = true;
      totalCacheRead += cost.cacheReadInputTokens ?? 0;
      totalCacheWrite += cost.cacheCreationInputTokens ?? 0;
    }
    totalNoCacheMicros += cost.estimatedCostNoCacheMicros ?? cost.estimatedCostMicros;
  }

  if (hasCacheData) {
    result.cacheReadInputTokens = totalCacheRead;
    result.cacheCreationInputTokens = totalCacheWrite;
    result.estimatedCostNoCacheMicros = totalNoCacheMicros;
  }

  return result;
}

/**
 * Format microdollars as a human-readable dollar string.
 */
export function formatCostMicros(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }
  return `$${dollars.toFixed(2)}`;
}
