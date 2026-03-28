/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {FailoverProvider} from './failover-provider.js';
import {ProviderError, RateLimitError} from './provider-errors.js';
import type {LLMChatRequest, LLMChatResponse} from './runtime-provider-types.js';

// Track which providers were constructed
const mockAnthropicChat = vi.fn();
const mockOpenAIChat = vi.fn();

vi.mock('./provider-factory.js', () => ({
  createRuntimeProvider: vi.fn().mockImplementation((config: {provider: string}) => {
    if (config.provider === 'anthropic') {
      return {chat: mockAnthropicChat};
    }
    if (config.provider === 'openai') {
      return {chat: mockOpenAIChat};
    }
    throw new ProviderError(`Unsupported: ${config.provider}`, {provider: config.provider});
  }),
}));

function makeRequest(overrides?: Partial<LLMChatRequest>): LLMChatRequest {
  return {
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are helpful.',
    messages: [{role: 'user', content: 'hello'}],
    tools: [],
    ...overrides,
  };
}

function makeResponse(overrides?: Partial<LLMChatResponse>): LLMChatResponse {
  return {
    content: [{type: 'text', text: 'Hello!'}],
    stopReason: 'end_turn',
    usage: {inputTokens: 10, outputTokens: 5},
    ...overrides,
  };
}

describe('FailoverProvider', () => {
  // Suppress unhandled rejections from retry timer cleanup when using fake timers
  const noop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    mockAnthropicChat.mockReset();
    mockOpenAIChat.mockReset();
    process.on('unhandledRejection', noop);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', noop);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('should succeed on first attempt', async () => {
    mockAnthropicChat.mockResolvedValue(makeResponse());

    const provider = new FailoverProvider({provider: 'anthropic', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content[0]).toEqual({type: 'text', text: 'Hello!'});
    expect(mockAnthropicChat).toHaveBeenCalledTimes(1);
  });

  it('should retry on rate limit (429)', async () => {
    mockAnthropicChat
      .mockRejectedValueOnce(new RateLimitError('Rate limited', {provider: 'anthropic'}))
      .mockResolvedValue(makeResponse());

    const provider = new FailoverProvider(
      {provider: 'anthropic', model: 'test'},
      {maxRetries: 2},
    );
    const responsePromise = provider.chat(makeRequest());
    await vi.advanceTimersByTimeAsync(2000);
    const response = await responsePromise;

    expect(response.content[0]).toEqual({type: 'text', text: 'Hello!'});
    expect(mockAnthropicChat).toHaveBeenCalledTimes(2);
  });

  it('should retry on 5xx errors', async () => {
    mockAnthropicChat
      .mockRejectedValueOnce(
        new ProviderError('Server error', {provider: 'anthropic', statusCode: 500, retryable: true}),
      )
      .mockResolvedValue(makeResponse());

    const provider = new FailoverProvider(
      {provider: 'anthropic', model: 'test'},
      {maxRetries: 2},
    );
    const responsePromise = provider.chat(makeRequest());
    await vi.advanceTimersByTimeAsync(2000);
    const response = await responsePromise;

    expect(response.stopReason).toBe('end_turn');
    expect(mockAnthropicChat).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable errors', async () => {
    mockAnthropicChat.mockRejectedValue(
      new ProviderError('Bad request', {provider: 'anthropic', statusCode: 400, retryable: false}),
    );

    const provider = new FailoverProvider(
      {provider: 'anthropic', model: 'test'},
      {maxRetries: 2},
    );

    await expect(provider.chat(makeRequest())).rejects.toThrow('Bad request');
    expect(mockAnthropicChat).toHaveBeenCalledTimes(1);
  });

  it('should fall back to fallback provider after retries exhausted', async () => {
    mockAnthropicChat.mockRejectedValue(
      new RateLimitError('Rate limited', {provider: 'anthropic'}),
    );
    mockOpenAIChat.mockResolvedValue(
      makeResponse({content: [{type: 'text', text: 'From fallback'}]}),
    );

    const provider = new FailoverProvider(
      {
        provider: 'anthropic',
        model: 'test',
        fallback: {provider: 'openai', model: 'gpt-4o'},
      },
      {maxRetries: 1},
    );
    const responsePromise = provider.chat(makeRequest());
    await vi.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;

    expect(response.content[0]).toEqual({type: 'text', text: 'From fallback'});
    // 1 initial + 1 retry = 2 attempts on primary
    expect(mockAnthropicChat).toHaveBeenCalledTimes(2);
    expect(mockOpenAIChat).toHaveBeenCalledTimes(1);
  });

  it('should fail if both primary and fallback fail', async () => {
    mockAnthropicChat.mockRejectedValue(
      new RateLimitError('Rate limited', {provider: 'anthropic'}),
    );
    mockOpenAIChat.mockRejectedValue(
      new ProviderError('OpenAI down', {provider: 'openai', statusCode: 500, retryable: true}),
    );

    const provider = new FailoverProvider(
      {
        provider: 'anthropic',
        model: 'test',
        fallback: {provider: 'openai', model: 'gpt-4o'},
      },
      {maxRetries: 0},
    );

    await expect(provider.chat(makeRequest())).rejects.toThrow('OpenAI down');
  });

  it('should fail with primary error when no fallback configured', async () => {
    mockAnthropicChat.mockRejectedValue(
      new RateLimitError('Rate limited', {provider: 'anthropic'}),
    );

    const provider = new FailoverProvider(
      {provider: 'anthropic', model: 'test'},
      {maxRetries: 0},
    );

    await expect(provider.chat(makeRequest())).rejects.toThrow('Rate limited');
  });

  it('should respect abort signal', async () => {
    mockAnthropicChat.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const controller = new AbortController();
    controller.abort();

    const provider = new FailoverProvider({provider: 'anthropic', model: 'test'});

    await expect(
      provider.chat(makeRequest({signal: controller.signal})),
    ).rejects.toThrow('aborted');
  });

  it('should try fallback even for non-retryable primary error', async () => {
    mockAnthropicChat.mockRejectedValue(
      new ProviderError('Auth failed', {provider: 'anthropic', statusCode: 401, retryable: false}),
    );
    mockOpenAIChat.mockResolvedValue(makeResponse());

    const provider = new FailoverProvider(
      {
        provider: 'anthropic',
        model: 'test',
        fallback: {provider: 'openai', model: 'gpt-4o'},
      },
      {maxRetries: 2},
    );
    const response = await provider.chat(makeRequest());

    expect(response.content[0]).toEqual({type: 'text', text: 'Hello!'});
    // Non-retryable: only 1 attempt on primary, then fallback
    expect(mockAnthropicChat).toHaveBeenCalledTimes(1);
    expect(mockOpenAIChat).toHaveBeenCalledTimes(1);
  });

  it('should use default maxRetries of 2', async () => {
    mockAnthropicChat
      .mockRejectedValueOnce(new RateLimitError('1', {provider: 'anthropic'}))
      .mockRejectedValueOnce(new RateLimitError('2', {provider: 'anthropic'}))
      .mockResolvedValue(makeResponse());

    const provider = new FailoverProvider({provider: 'anthropic', model: 'test'});
    const responsePromise = provider.chat(makeRequest());
    await vi.advanceTimersByTimeAsync(10000);
    const response = await responsePromise;

    expect(response.stopReason).toBe('end_turn');
    // 1 initial + 2 retries = 3 attempts
    expect(mockAnthropicChat).toHaveBeenCalledTimes(3);
  });

  it('should exhaust retries then fail when all retries fail and no fallback', async () => {
    mockAnthropicChat.mockRejectedValue(
      new RateLimitError('Rate limited', {provider: 'anthropic'}),
    );

    const provider = new FailoverProvider(
      {provider: 'anthropic', model: 'test'},
      {maxRetries: 1},
    );

    const responsePromise = provider.chat(makeRequest());
    // Flush all pending timers so retries complete
    await vi.runAllTimersAsync();
    await expect(responsePromise).rejects.toThrow('Rate limited');
    // 1 initial + 1 retry = 2 total
    expect(mockAnthropicChat).toHaveBeenCalledTimes(2);
  });
});
