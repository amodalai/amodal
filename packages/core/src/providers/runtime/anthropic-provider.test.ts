/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AnthropicRuntimeProvider} from './anthropic-provider.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';
import type {LLMChatRequest} from './runtime-provider-types.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {create: mockCreate},
  })),
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

describe('AnthropicRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw if ANTHROPIC_API_KEY is not set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect(
      () => new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'}),
    ).toThrow('ANTHROPIC_API_KEY');
  });

  it('should return text response', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'Hello!'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 10, output_tokens: 5},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([{type: 'text', text: 'Hello!'}]);
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({inputTokens: 10, outputTokens: 5});
  });

  it('should return tool use response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
      ],
      stop_reason: 'tool_use',
      usage: {input_tokens: 20, output_tokens: 15},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
    ]);
    expect(response.stopReason).toBe('tool_use');
  });

  it('should return mixed text and tool use', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {type: 'text', text: 'Let me check.'},
        {type: 'tool_use', id: 'tc-1', name: 'request', input: {}},
      ],
      stop_reason: 'tool_use',
      usage: {input_tokens: 30, output_tokens: 20},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toHaveLength(2);
    expect(response.content[0]?.type).toBe('text');
    expect(response.content[1]?.type).toBe('tool_use');
  });

  it('should convert system prompt to top-level param', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 5, output_tokens: 3},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await provider.chat(makeRequest({systemPrompt: 'Be concise.'}));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [{type: 'text', text: 'Be concise.', cache_control: {type: 'ephemeral'}}],
      }),
    );
  });

  it('should convert tool definitions to Anthropic format', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 5, output_tokens: 3},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await provider.chat(
      makeRequest({
        tools: [{name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}}],
      }),
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{name: 'my_tool', description: 'does stuff', input_schema: {type: 'object'}, cache_control: {type: 'ephemeral'}}],
      }),
    );
  });

  it('should convert message history with structured assistant content', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 5, output_tokens: 3},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
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
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[0]).toEqual({role: 'user', content: 'hello'});
    expect(callArgs.messages[1].role).toBe('assistant');
    expect(callArgs.messages[2].role).toBe('user'); // tool_result → user in Anthropic
    expect(callArgs.messages[2].content[0].type).toBe('tool_result');
  });

  it('should convert tool result with isError', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 5, output_tokens: 3},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await provider.chat(
      makeRequest({
        messages: [
          {role: 'user', content: 'hello'},
          {role: 'assistant', content: [{type: 'tool_use', id: 'tc-1', name: 'request', input: {}}]},
          {role: 'tool_result', toolCallId: 'tc-1', content: 'failed', isError: true},
        ],
      }),
    );

    const callArgs = mockCreate.mock.calls[0]?.[0];
    const toolResultMsg = callArgs.messages[2];
    expect(toolResultMsg.content[0].is_error).toBe(true);
  });

  it('should throw RateLimitError on 429', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Too many requests'), {status: 429}));

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw ProviderTimeoutError on timeout', async () => {
    mockCreate.mockRejectedValue(new Error('Request timeout'));

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(ProviderTimeoutError);
  });

  it('should mark 5xx as retryable', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Internal error'), {status: 500}));

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it('should mark 4xx (non-429) as non-retryable', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Bad request'), {status: 400}));

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(false);
    }
  });

  it('should map max_tokens stop reason', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'partial'}],
      stop_reason: 'max_tokens',
      usage: {input_tokens: 5, output_tokens: 4096},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    const response = await provider.chat(makeRequest());
    expect(response.stopReason).toBe('max_tokens');
  });

  it('should pass custom baseUrl', async () => {
    const {default: Anthropic} = await import('@anthropic-ai/sdk');

    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 5, output_tokens: 3},
    });

    const provider = new AnthropicRuntimeProvider({
      provider: 'anthropic',
      model: 'test',
      baseUrl: 'https://custom.api.com',
    });
    await provider.chat(makeRequest());

    expect(Anthropic).toHaveBeenCalledWith(
      expect.objectContaining({baseURL: 'https://custom.api.com'}),
    );
  });

  it('should format image content parts in user messages', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'I see a red square.'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 100, output_tokens: 10},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await provider.chat(makeRequest({
      messages: [{
        role: 'user',
        content: [
          {type: 'image', mimeType: 'image/png', data: 'dGVzdA=='},
          {type: 'text', text: 'What is this?'},
        ],
      }],
    }));

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = callArgs['messages'] as Array<Record<string, unknown>>;
    const userMsg = messages[0];
    expect(userMsg['role']).toBe('user');
    const content = userMsg['content'] as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: 'image',
      source: {type: 'base64', media_type: 'image/png', data: 'dGVzdA=='},
    });
    expect(content[1]).toEqual({type: 'text', text: 'What is this?'});
  });

  it('should pass plain string content unchanged', async () => {
    mockCreate.mockResolvedValue({
      content: [{type: 'text', text: 'Hi!'}],
      stop_reason: 'end_turn',
      usage: {input_tokens: 10, output_tokens: 5},
    });

    const provider = new AnthropicRuntimeProvider({provider: 'anthropic', model: 'test'});
    await provider.chat(makeRequest({
      messages: [{role: 'user', content: 'just text'}],
    }));

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = callArgs['messages'] as Array<Record<string, unknown>>;
    expect(messages[0]['content']).toBe('just text');
  });
});
