/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {OpenAIRuntimeProvider} from './openai-provider.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';
import type {LLMChatRequest} from './runtime-provider-types.js';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
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

describe('OpenAIRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw if OPENAI_API_KEY is not set and no baseUrl', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(
      () => new OpenAIRuntimeProvider({provider: 'openai', model: 'test'}),
    ).toThrow('OPENAI_API_KEY');
  });

  it('should allow missing API key with baseUrl (OpenAI-compatible)', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(
      () => new OpenAIRuntimeProvider({provider: 'openai', model: 'test', baseUrl: 'http://localhost:8000'}),
    ).not.toThrow();
  });

  it('should return text response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {content: 'Hello!', tool_calls: undefined},
        finish_reason: 'stop',
      }],
      usage: {prompt_tokens: 10, completion_tokens: 5},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([{type: 'text', text: 'Hello!'}]);
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({inputTokens: 10, outputTokens: 5});
  });

  it('should return tool use response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            {id: 'tc-1', type: 'function', function: {name: 'request', arguments: '{"url":"/api"}'}},
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {prompt_tokens: 20, completion_tokens: 15},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
    ]);
    expect(response.stopReason).toBe('tool_use');
  });

  it('should handle mixed text and tool calls', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: 'Let me check.',
          tool_calls: [
            {id: 'tc-1', type: 'function', function: {name: 'request', arguments: '{}'}},
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {prompt_tokens: 30, completion_tokens: 20},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toHaveLength(2);
    expect(response.content[0]?.type).toBe('text');
    expect(response.content[1]?.type).toBe('tool_use');
  });

  it('should handle malformed JSON in tool arguments', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            {id: 'tc-1', type: 'function', function: {name: 'request', arguments: 'not json'}},
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {prompt_tokens: 10, completion_tokens: 5},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    const response = await provider.chat(makeRequest());

    // Should gracefully fall back to empty input
    expect(response.content[0]).toEqual(
      expect.objectContaining({type: 'tool_use', input: {}}),
    );
  });

  it('should send system prompt as first message', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {content: 'ok'},
        finish_reason: 'stop',
      }],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await provider.chat(makeRequest({systemPrompt: 'Be concise.'}));

    const callArgs = mockCreate.mock.calls[0]?.[0];
    expect(callArgs.messages[0]).toEqual({role: 'system', content: 'Be concise.'});
  });

  it('should convert tool definitions to OpenAI format', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await provider.chat(
      makeRequest({
        tools: [{name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}}],
      }),
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{
          type: 'function',
          function: {name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}},
        }],
      }),
    );
  });

  it('should convert structured assistant messages to OpenAI format', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await provider.chat(
      makeRequest({
        messages: [
          {role: 'user', content: 'hello'},
          {
            role: 'assistant',
            content: [
              {type: 'text', text: 'Checking...'},
              {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
            ],
          },
          {role: 'tool_result', toolCallId: 'tc-1', content: '{"ok":true}'},
        ],
      }),
    );

    const callArgs = mockCreate.mock.calls[0]?.[0];
    // system + user + assistant + tool = 4 messages
    expect(callArgs.messages).toHaveLength(4);
    expect(callArgs.messages[1]).toEqual({role: 'user', content: 'hello'});

    const assistantMsg = callArgs.messages[2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('Checking...');
    expect(assistantMsg.tool_calls[0].function.name).toBe('request');
    expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"url":"/api"}');

    const toolMsg = callArgs.messages[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('tc-1');
  });

  it('should throw RateLimitError on 429', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Rate limit'), {status: 429}));

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw ProviderTimeoutError on timeout', async () => {
    mockCreate.mockRejectedValue(new Error('Request timeout'));

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(ProviderTimeoutError);
  });

  it('should mark 5xx as retryable', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Internal error'), {status: 500}));

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it('should throw on empty choices', async () => {
    mockCreate.mockResolvedValue({choices: [], usage: {prompt_tokens: 5, completion_tokens: 0}});

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow('no choices');
  });

  it('should map length finish_reason to max_tokens', async () => {
    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'partial'}, finish_reason: 'length'}],
      usage: {prompt_tokens: 5, completion_tokens: 4096},
    });

    const provider = new OpenAIRuntimeProvider({provider: 'openai', model: 'test'});
    const response = await provider.chat(makeRequest());
    expect(response.stopReason).toBe('max_tokens');
  });

  it('should pass custom baseUrl', async () => {
    const {default: OpenAI} = await import('openai');

    mockCreate.mockResolvedValue({
      choices: [{message: {content: 'ok'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 5, completion_tokens: 3},
    });

    const provider = new OpenAIRuntimeProvider({
      provider: 'openai',
      model: 'test',
      baseUrl: 'http://localhost:8000/v1',
    });
    await provider.chat(makeRequest());

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({baseURL: 'http://localhost:8000/v1'}),
    );
  });
});
