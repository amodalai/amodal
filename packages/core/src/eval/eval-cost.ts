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
export const MODEL_PRICING: Record<string, {inputPerMToken: number; outputPerMToken: number}> = {
  // Anthropic
  'claude-opus-4-20250514': {inputPerMToken: 15_000_000, outputPerMToken: 75_000_000},
  'claude-sonnet-4-20250514': {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000},
  'claude-sonnet-4-6-20250626': {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000},
  'claude-haiku-3-5-20241022': {inputPerMToken: 800_000, outputPerMToken: 4_000_000},
  'claude-haiku-4-5-20251001': {inputPerMToken: 800_000, outputPerMToken: 4_000_000},
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
};

// Default pricing for unknown models (conservative estimate)
const DEFAULT_PRICING = {inputPerMToken: 3_000_000, outputPerMToken: 15_000_000};

/**
 * Look up pricing for a model, falling back to default for unknown models.
 */
export function getModelPricing(model: string): {inputPerMToken: number; outputPerMToken: number} {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/**
 * Compute cost info from token counts and model identity.
 */
export function computeEvalCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): EvalCostInfo {
  const pricing = getModelPricing(model);
  const totalTokens = inputTokens + outputTokens;
  const estimatedCostMicros = Math.round(
    (inputTokens * pricing.inputPerMToken + outputTokens * pricing.outputPerMToken) / 1_000_000,
  );

  return {inputTokens, outputTokens, totalTokens, estimatedCostMicros};
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

  for (const cost of perCaseCosts) {
    result.inputTokens += cost.inputTokens;
    result.outputTokens += cost.outputTokens;
    result.totalTokens += cost.totalTokens;
    result.estimatedCostMicros += cost.estimatedCostMicros;
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
