/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {SessionEvalQueryProvider} from './eval-session-provider.js';

vi.mock('../providers/runtime/provider-factory.js', () => ({
  createRuntimeProvider: vi.fn(() => ({
    chat: vi.fn().mockResolvedValue({
      content: [
        {type: 'text', text: 'The answer is 42'},
        {type: 'tool_use', id: 'call_1', name: 'calculator', input: {expression: '6*7'}},
      ],
      stopReason: 'end_turn',
      usage: {inputTokens: 100, outputTokens: 50},
    }),
  })),
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
    const {createRuntimeProvider} = await import('../providers/runtime/provider-factory.js');
    (createRuntimeProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      chat: vi.fn().mockResolvedValue({
        content: [{type: 'text', text: 'Just text'}],
        stopReason: 'end_turn',
        usage: {inputTokens: 50, outputTokens: 20},
      }),
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
    const {createRuntimeProvider} = await import('../providers/runtime/provider-factory.js');
    (createRuntimeProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      chat: vi.fn().mockResolvedValue({
        content: [{type: 'text', text: 'No usage'}],
        stopReason: 'end_turn',
      }),
    });

    const provider = new SessionEvalQueryProvider({
      modelConfig: {provider: 'google', model: 'gemini-2.5-flash'},
    });

    const result = await provider.query('Test');
    expect(result.usage).toBeUndefined();
  });
});
