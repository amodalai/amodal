/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {MODEL_PRICING, computeEvalCost} from '@amodalai/core';
import type {TokenUsage} from '../providers/types.js';
import type {SessionCostSnapshot} from './types.js';

export function estimateSessionCostSnapshot(
  provider: string,
  model: string,
  usage: TokenUsage,
  computedAt: Date = new Date(),
): SessionCostSnapshot | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const billableInputTokens = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const cost = computeEvalCost(
    billableInputTokens,
    usage.outputTokens,
    model,
    cacheRead,
    cacheWrite,
  );

  return {
    currency: 'USD',
    estimatedCostMicros: cost.estimatedCostMicros,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    billableInputTokens,
    ...(cost.cacheReadInputTokens !== undefined ? {cacheReadInputTokens: cost.cacheReadInputTokens} : {}),
    ...(cost.cacheCreationInputTokens !== undefined ? {cacheCreationInputTokens: cost.cacheCreationInputTokens} : {}),
    ...(cost.estimatedCostNoCacheMicros !== undefined ? {estimatedCostNoCacheMicros: cost.estimatedCostNoCacheMicros} : {}),
    pricing: {
      provider,
      model,
      inputPerMToken: pricing.inputPerMToken,
      outputPerMToken: pricing.outputPerMToken,
      ...(pricing.cacheReadPerMToken !== undefined ? {cacheReadPerMToken: pricing.cacheReadPerMToken} : {}),
      ...(pricing.cacheWritePerMToken !== undefined ? {cacheWritePerMToken: pricing.cacheWritePerMToken} : {}),
      source: 'amodal-core-model-pricing',
    },
    computedAt: computedAt.toISOString(),
  };
}

export function isSessionCostSnapshot(value: unknown): value is SessionCostSnapshot {
  if (!value || typeof value !== 'object') return false;
  const pricing = Reflect.get(value, 'pricing');
  return Reflect.get(value, 'currency') === 'USD' &&
    typeof Reflect.get(value, 'estimatedCostMicros') === 'number' &&
    typeof Reflect.get(value, 'inputTokens') === 'number' &&
    typeof Reflect.get(value, 'outputTokens') === 'number' &&
    typeof Reflect.get(value, 'totalTokens') === 'number' &&
    typeof Reflect.get(value, 'billableInputTokens') === 'number' &&
    typeof pricing === 'object' &&
    pricing !== null;
}
