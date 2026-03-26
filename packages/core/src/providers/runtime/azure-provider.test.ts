/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AzureOpenAIRuntimeProvider} from './azure-provider.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';
import type {LLMChatRequest} from './runtime-provider-types.js';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {completions: {create: mockCreate}},
  })),
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    chat: {completions: {create: mockCreate}},
  })),
}));

function makeRequest(overrides?: Partial<LLMChatRequest>): LLMChatRequest {
  return {
    model: 'gpt-4o',
    systemPrompt: 'You are helpful.',
    messages: [{role: 'user', content: 'hello'}],
    tools: [],
    ...overrides,
  };
}

describe('AzureOpenAIRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key');
    vi.stubEnv('AZURE_OPENAI_RESOURCE', 'my-resource');
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw if AZURE_OPENAI_API_KEY is not set', () => {
    delete process.env['AZURE_OPENAI_API_KEY'];
    expect(
      () => new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'}),
    ).toThrow('AZURE_OPENAI_API_KEY');
  });

  it('should throw if AZURE_OPENAI_RESOURCE is not set and no baseUrl', () => {
    delete process.env['AZURE_OPENAI_RESOURCE'];
    expect(
      () => new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'}),
    ).toThrow('AZURE_OPENAI_RESOURCE');
  });

  it('should create AzureOpenAI client with resource endpoint', async () => {
    const {AzureOpenAI} = await import('openai');

    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    await provider.chat(makeRequest());

    expect(AzureOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        endpoint: 'https://my-resource.openai.azure.com',
        deployment: 'gpt-4o',
      }),
    );
  });

  it('should return text response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'Hello!'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 10, completion_tokens: 5},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([{type: 'text', text: 'Hello!'}]);
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({inputTokens: 10, outputTokens: 5});
  });

  it('should return tool use response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {name: 'request', arguments: '{"url":"/api"}'},
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {prompt_tokens: 20, completion_tokens: 15},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
    ]);
    expect(response.stopReason).toBe('tool_use');
  });

  it('should convert message history', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
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

    const callArgs = mockCreate.mock.calls[0]?.[0];
    // system + user + assistant + tool
    expect(callArgs.messages).toHaveLength(4);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[3].role).toBe('tool');
  });

  it('should throw RateLimitError on 429', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Too many requests'), {status: 429}));

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw ProviderTimeoutError on timeout', async () => {
    mockCreate.mockRejectedValue(new Error('Request timeout'));

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(ProviderTimeoutError);
  });

  it('should mark 5xx as retryable', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Internal error'), {status: 500}));

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it('should handle malformed JSON in tool arguments', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {name: 'request', arguments: 'not json'},
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {prompt_tokens: 10, completion_tokens: 5},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'tc-1', name: 'request', input: {}},
    ]);
  });

  it('should use custom API version from env', async () => {
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2025-01-01');
    const {AzureOpenAI} = await import('openai');

    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    await provider.chat(makeRequest());

    expect(AzureOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({apiVersion: '2025-01-01'}),
    );
  });

  it('should map length finish reason to max_tokens', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'partial'}, finish_reason: 'length'}],
      usage: {prompt_tokens: 5, completion_tokens: 4096},
    });

    const provider = new AzureOpenAIRuntimeProvider({provider: 'azure', model: 'gpt-4o'});
    const response = await provider.chat(makeRequest());
    expect(response.stopReason).toBe('max_tokens');
  });
});
