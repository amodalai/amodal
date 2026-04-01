/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {
  MODEL_PRICING,
  getModelPricing,
  computeEvalCost,
  aggregateRunCost,
  formatCostMicros,
} from './eval-cost.js';

describe('getModelPricing', () => {
  it('returns pricing for known Anthropic model', () => {
    const pricing = getModelPricing('claude-sonnet-4-20250514');
    expect(pricing.inputPerMToken).toBe(3_000_000);
    expect(pricing.outputPerMToken).toBe(15_000_000);
  });

  it('returns pricing for known OpenAI model', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing.inputPerMToken).toBe(2_500_000);
    expect(pricing.outputPerMToken).toBe(10_000_000);
  });

  it('returns pricing for known Google model', () => {
    const pricing = getModelPricing('gemini-2.5-flash');
    expect(pricing.inputPerMToken).toBe(300_000);
    expect(pricing.outputPerMToken).toBe(2_500_000);
  });

  it('returns default pricing for unknown model', () => {
    const pricing = getModelPricing('unknown-model-xyz');
    expect(pricing.inputPerMToken).toBe(3_000_000);
    expect(pricing.outputPerMToken).toBe(15_000_000);
  });
});

describe('computeEvalCost', () => {
  it('computes cost for known model', () => {
    const cost = computeEvalCost(1000, 500, 'claude-sonnet-4-20250514');
    expect(cost.inputTokens).toBe(1000);
    expect(cost.outputTokens).toBe(500);
    expect(cost.totalTokens).toBe(1500);
    // 1000 * 3_000_000 / 1_000_000 + 500 * 15_000_000 / 1_000_000 = 3000 + 7500 = 10500
    expect(cost.estimatedCostMicros).toBe(10500);
  });

  it('computes cost for zero tokens', () => {
    const cost = computeEvalCost(0, 0, 'gpt-4o');
    expect(cost.totalTokens).toBe(0);
    expect(cost.estimatedCostMicros).toBe(0);
  });

  it('uses default pricing for unknown model', () => {
    const cost = computeEvalCost(1000, 1000, 'mystery-model');
    expect(cost.estimatedCostMicros).toBe(
      Math.round((1000 * 3_000_000 + 1000 * 15_000_000) / 1_000_000),
    );
  });

  it('rounds cost to nearest integer', () => {
    // Small token counts that could produce fractional microdollars
    const cost = computeEvalCost(1, 1, 'gemini-2.0-flash');
    expect(Number.isInteger(cost.estimatedCostMicros)).toBe(true);
  });
});

describe('aggregateRunCost', () => {
  it('sums all cost fields', () => {
    const costs = [
      {inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostMicros: 1000},
      {inputTokens: 200, outputTokens: 100, totalTokens: 300, estimatedCostMicros: 2000},
      {inputTokens: 300, outputTokens: 150, totalTokens: 450, estimatedCostMicros: 3000},
    ];

    const total = aggregateRunCost(costs);
    expect(total.inputTokens).toBe(600);
    expect(total.outputTokens).toBe(300);
    expect(total.totalTokens).toBe(900);
    expect(total.estimatedCostMicros).toBe(6000);
  });

  it('returns zero for empty array', () => {
    const total = aggregateRunCost([]);
    expect(total.inputTokens).toBe(0);
    expect(total.outputTokens).toBe(0);
    expect(total.totalTokens).toBe(0);
    expect(total.estimatedCostMicros).toBe(0);
  });

  it('handles single item', () => {
    const costs = [{inputTokens: 42, outputTokens: 18, totalTokens: 60, estimatedCostMicros: 500}];
    const total = aggregateRunCost(costs);
    expect(total).toEqual(costs[0]);
  });
});

describe('formatCostMicros', () => {
  it('formats small amounts with 4 decimal places', () => {
    expect(formatCostMicros(500)).toBe('$0.0005');
  });

  it('formats larger amounts with 2 decimal places', () => {
    expect(formatCostMicros(1_500_000)).toBe('$1.50');
  });

  it('formats zero', () => {
    expect(formatCostMicros(0)).toBe('$0.0000');
  });

  it('formats amounts just at the threshold', () => {
    expect(formatCostMicros(10_000)).toBe('$0.01');
  });
});

describe('MODEL_PRICING', () => {
  it('has entries for major providers', () => {
    const models = Object.keys(MODEL_PRICING);
    expect(models.some((m) => m.startsWith('claude'))).toBe(true);
    expect(models.some((m) => m.startsWith('gpt'))).toBe(true);
    expect(models.some((m) => m.startsWith('gemini'))).toBe(true);
  });

  it('all pricing values are positive', () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPerMToken).toBeGreaterThan(0);
      expect(pricing.outputPerMToken).toBeGreaterThan(0);
    }
  });
});
