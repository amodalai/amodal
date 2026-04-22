/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {SessionEvalQueryProvider} from './eval-session-provider.js';

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'The answer is 42',
    toolCalls: [{toolName: 'calculator', input: {expression: '6*7'}}],
    usage: {inputTokens: 100, outputTokens: 50},
  }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({modelId: 'claude-sonnet-4-20250514'}))),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({modelId: 'gpt-4o'}))),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({modelId: 'gemini-2.5-flash'}))),
}));

describe('SessionEvalQueryProvider', () => {
  it('returns response text, tool calls, and usage', async () => {
    const provider = new SessionEvalQueryProvider({
      modelConfig: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
    });

    const result = await provider.query('What is 6*7?');

    expect(result.response).toBe('The answer is 42');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('calculator');
    expect(result.toolCalls[0].parameters).toEqual({expression: '6*7'});
    expect(result.usage).toEqual({inputTokens: 100, outputTokens: 50});
  });

  it('handles text-only response', async () => {
    const {generateText} = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'Just text',
      toolCalls: [],
      usage: {inputTokens: 50, outputTokens: 20},
    });

    const provider = new SessionEvalQueryProvider({
      modelConfig: {provider: 'openai', model: 'gpt-4o'},
      systemPrompt: 'Be concise.',
      maxTokens: 1024,
    });

    const result = await provider.query('Hello');
    expect(result.response).toBe('Just text');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('handles response with no usage data', async () => {
    const {generateText} = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'No usage',
      toolCalls: [],
      usage: undefined,
    });

    const provider = new SessionEvalQueryProvider({
      modelConfig: {provider: 'google', model: 'gemini-2.5-flash'},
    });

    const result = await provider.query('Test');
    expect(result.usage).toBeUndefined();
  });
});
