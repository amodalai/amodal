/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import type {ModelMessage} from 'ai';
import {estimateTokenCount} from './token-estimate.js';
import type {LLMProvider} from '../providers/types.js';

describe('estimateTokenCount', () => {
  const messages: ModelMessage[] = [
    {role: 'user', content: 'Hello world'},
    {role: 'assistant', content: 'Hi there!'},
  ];

  it('falls back to 4-chars heuristic when no provider given', () => {
    const count = estimateTokenCount(messages);
    const serialized = JSON.stringify(messages);
    expect(count).toBe(Math.ceil(serialized.length / 4));
  });

  it('falls back to heuristic when provider lacks countTokens', () => {
    const provider = {
      model: 'test',
      provider: 'test',
      languageModel: {} as LLMProvider['languageModel'],
      streamText: vi.fn(),
      generateText: vi.fn(),
    } satisfies LLMProvider;

    const count = estimateTokenCount(messages, provider);
    expect(count).toBe(Math.ceil(JSON.stringify(messages).length / 4));
  });

  it('delegates to provider.countTokens when implemented', () => {
    const countTokens = vi.fn().mockReturnValue(42);
    const provider = {
      model: 'test',
      provider: 'test',
      languageModel: {} as LLMProvider['languageModel'],
      streamText: vi.fn(),
      generateText: vi.fn(),
      countTokens,
    } satisfies LLMProvider;

    const count = estimateTokenCount(messages, provider);
    expect(count).toBe(42);
    expect(countTokens).toHaveBeenCalledWith(messages);
  });
});
