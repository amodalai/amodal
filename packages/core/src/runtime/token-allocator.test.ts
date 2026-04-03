/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';

import type {ContextSection} from './runtime-types.js';
import {getModelContextWindow, TokenAllocator} from './token-allocator.js';

function makeSection(
  name: string,
  content: string,
  priority: number,
): ContextSection {
  return {name, content, tokens: 0, priority, trimmed: false};
}

describe('getModelContextWindow', () => {
  it('returns large context for known model families', () => {
    expect(getModelContextWindow('claude-sonnet-4-6')).toBeGreaterThanOrEqual(200_000);
    expect(getModelContextWindow('gemini-2.5-pro')).toBeGreaterThanOrEqual(200_000);
    expect(getModelContextWindow('gpt-4o')).toBeGreaterThanOrEqual(128_000);
  });

  it('returns a reasonable default for unknown models', () => {
    const ctx = getModelContextWindow('llama-3');
    expect(ctx).toBeGreaterThanOrEqual(32_000);
    expect(ctx).toBeLessThanOrEqual(1_000_000);
  });

  it('is case insensitive', () => {
    expect(getModelContextWindow('Claude-Sonnet')).toBe(getModelContextWindow('claude-sonnet'));
    expect(getModelContextWindow('GEMINI-PRO')).toBe(getModelContextWindow('gemini-pro'));
  });
});

describe('TokenAllocator', () => {
  describe('estimateTokens', () => {
    it('estimates 1000 chars as approximately 250 tokens', () => {
      const allocator = new TokenAllocator(128_000);
      const text = 'a'.repeat(1000);
      expect(allocator.estimateTokens(text)).toBe(250);
    });

    it('returns 0 for empty string', () => {
      const allocator = new TokenAllocator(128_000);
      expect(allocator.estimateTokens('')).toBe(0);
    });

    it('rounds up for non-divisible lengths', () => {
      const allocator = new TokenAllocator(128_000);
      // 5 chars / 4 = 1.25, should ceil to 2
      expect(allocator.estimateTokens('hello')).toBe(2);
    });
  });

  describe('allocate', () => {
    it('includes all sections when they fit within budget', () => {
      const allocator = new TokenAllocator(10_000);
      const sections = [
        makeSection('a', 'a'.repeat(400), 5),
        makeSection('b', 'b'.repeat(400), 3),
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(2);
      expect(result.trimmed).toHaveLength(0);
      expect(result.included.every((s) => !s.trimmed)).toBe(true);
    });

    it('trims lowest priority section first when over budget', () => {
      // Budget: 100 tokens (500 context window - 400 reserve)
      const allocator = new TokenAllocator(500, 400);
      const sections = [
        makeSection('high', 'a'.repeat(200), 10), // 50 tokens
        makeSection('low', 'b'.repeat(300), 1), // 75 tokens — total 125, budget 100
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(1);
      expect(result.included[0]).toHaveProperty('name', 'high');
      expect(result.trimmed).toHaveLength(1);
      expect(result.trimmed[0]).toHaveProperty('name', 'low');
      expect(result.trimmed[0]).toHaveProperty('content', '');
      expect(result.trimmed[0]).toHaveProperty('tokens', 0);
      expect(result.trimmed[0]).toHaveProperty('trimmed', true);
    });

    it('trims multiple sections in priority order', () => {
      const allocator = new TokenAllocator(200, 100); // 100 token budget
      const sections = [
        makeSection('critical', 'a'.repeat(200), 10), // 50
        makeSection('medium', 'b'.repeat(200), 5), // 50
        makeSection('low', 'c'.repeat(200), 1), // 50 — total 150, budget 100
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(2);
      expect(result.trimmed).toHaveLength(1);
      expect(result.trimmed[0]).toHaveProperty('name', 'low');
    });

    it('handles case where nothing fits except highest priority', () => {
      const allocator = new TokenAllocator(100, 0); // 100 token budget
      const sections = [
        makeSection('must_keep', 'a'.repeat(300), 10), // 75
        makeSection('extra1', 'b'.repeat(200), 2), // 50
        makeSection('extra2', 'c'.repeat(200), 1), // 50 — total 175
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(1);
      expect(result.included[0]).toHaveProperty('name', 'must_keep');
      expect(result.trimmed).toHaveLength(2);
    });

    it('handles zero-length section content', () => {
      const allocator = new TokenAllocator(10_000);
      const sections = [
        makeSection('empty', '', 5),
        makeSection('real', 'some content', 3),
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(2);
      expect(result.included[0]).toHaveProperty('tokens', 0);
    });

    it('accounts for reserve in budget calculation', () => {
      // 200 context - 150 reserve = 50 budget
      const allocator = new TokenAllocator(200, 150);
      const sections = [
        makeSection('fits', 'a'.repeat(160), 5), // 40 tokens — fits in 50
      ];

      const result = allocator.allocate(sections);

      expect(result.included).toHaveLength(1);
      expect(result.totalTokens).toBe(40);
    });

    it('returns correct totalTokens for included sections', () => {
      const allocator = new TokenAllocator(500, 0);
      const sections = [
        makeSection('a', 'x'.repeat(100), 5), // 25
        makeSection('b', 'y'.repeat(200), 3), // 50
      ];

      const result = allocator.allocate(sections);

      expect(result.totalTokens).toBe(75);
    });
  });
});
