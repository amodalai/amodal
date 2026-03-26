/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {GoogleRuntimeProvider} from './google-provider.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';
import type {LLMChatRequest} from './runtime-provider-types.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {generateContent: mockGenerateContent},
  })),
}));

function makeRequest(overrides?: Partial<LLMChatRequest>): LLMChatRequest {
  return {
    model: 'gemini-2.0-flash',
    systemPrompt: 'You are helpful.',
    messages: [{role: 'user', content: 'hello'}],
    tools: [],
    ...overrides,
  };
}

describe('GoogleRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key');
    mockGenerateContent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw if GOOGLE_API_KEY is not set', () => {
    delete process.env['GOOGLE_API_KEY'];
    expect(
      () => new GoogleRuntimeProvider({provider: 'google', model: 'test'}),
    ).toThrow('GOOGLE_API_KEY');
  });

  it('should return text response', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'Hello!'}]},
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([{type: 'text', text: 'Hello!'}]);
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({inputTokens: 10, outputTokens: 5});
  });

  it('should return function call response', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {functionCall: {id: 'fc-1', name: 'request', args: {url: '/api'}}},
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 20, candidatesTokenCount: 15},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'fc-1', name: 'request', input: {url: '/api'}},
    ]);
  });

  it('should return mixed text and function call', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {text: 'Let me check.'},
              {functionCall: {id: 'fc-1', name: 'request', args: {}}},
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 30, candidatesTokenCount: 20},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toHaveLength(2);
    expect(response.content[0]?.type).toBe('text');
    expect(response.content[1]?.type).toBe('tool_use');
  });

  it('should pass system instruction via config', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'ok'}]},
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await provider.chat(makeRequest({systemPrompt: 'Be concise.'}));

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({systemInstruction: 'Be concise.'}),
      }),
    );
  });

  it('should convert tool definitions to function declarations', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'ok'}]},
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await provider.chat(
      makeRequest({
        tools: [{name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}}],
      }),
    );

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [{functionDeclarations: [{name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}}]}],
        }),
      }),
    );
  });

  it('should convert message history with assistant tool calls', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'ok'}]},
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await provider.chat(
      makeRequest({
        messages: [
          {role: 'user', content: 'hello'},
          {
            role: 'assistant',
            content: [
              {type: 'text', text: 'Let me check.'},
              {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
            ],
          },
          {role: 'tool_result', toolCallId: 'tc-1', content: '{"ok":true}'},
        ],
      }),
    );

    const callArgs = mockGenerateContent.mock.calls[0]?.[0];
    expect(callArgs.contents).toHaveLength(3);
    expect(callArgs.contents[0].role).toBe('user');
    expect(callArgs.contents[1].role).toBe('model');
    expect(callArgs.contents[2].role).toBe('user'); // function response
  });

  it('should handle tool result with plain text content', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'ok'}]},
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await provider.chat(
      makeRequest({
        messages: [
          {role: 'user', content: 'hello'},
          {role: 'assistant', content: [{type: 'tool_use', id: 'tc-1', name: 'request', input: {}}]},
          {role: 'tool_result', toolCallId: 'tc-1', content: 'plain text result'},
        ],
      }),
    );

    const callArgs = mockGenerateContent.mock.calls[0]?.[0];
    const toolResult = callArgs.contents[2];
    expect(toolResult.parts[0].functionResponse.response).toEqual({result: 'plain text result'});
  });

  it('should generate fallback id for function calls without id', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {functionCall: {name: 'request', args: {url: '/api'}}},
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content[0]?.type).toBe('tool_use');
    const toolUse = response.content[0];
    if (toolUse?.type === 'tool_use') {
      expect(toolUse.id).toMatch(/^call_request_/);
      expect(toolUse.name).toBe('request');
    }
  });

  it('should throw RateLimitError on 429', async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error('Too many requests'), {status: 429}));

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw ProviderTimeoutError on timeout', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(ProviderTimeoutError);
  });

  it('should mark 5xx as retryable', async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error('Internal error'), {status: 500}));

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it('should mark 4xx (non-429) as non-retryable', async () => {
    mockGenerateContent.mockRejectedValue(Object.assign(new Error('Bad request'), {status: 400}));

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(false);
    }
  });

  it('should map MAX_TOKENS finish reason', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {parts: [{text: 'partial'}]},
          finishReason: 'MAX_TOKENS',
        },
      ],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 4096},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    const response = await provider.chat(makeRequest());
    expect(response.stopReason).toBe('max_tokens');
  });

  it('should throw on no candidates', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 0},
    });

    const provider = new GoogleRuntimeProvider({provider: 'google', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow('no candidates');
  });
});
