/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {BedrockRuntimeProvider} from './bedrock-provider.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';
import type {LLMChatRequest} from './runtime-provider-types.js';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({send: mockSend})),
  ConverseCommand: vi.fn().mockImplementation((input: unknown) => ({input})),
}));

function makeRequest(overrides?: Partial<LLMChatRequest>): LLMChatRequest {
  return {
    model: 'anthropic.claude-3-sonnet-20240229-v1:0',
    systemPrompt: 'You are helpful.',
    messages: [{role: 'user', content: 'hello'}],
    tools: [],
    ...overrides,
  };
}

describe('BedrockRuntimeProvider', () => {
  beforeEach(() => {
    vi.stubEnv('AWS_REGION', 'us-east-1');
    mockSend.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should default region to us-east-1', async () => {
    const {BedrockRuntimeClient} = await import('@aws-sdk/client-bedrock-runtime');

    delete process.env['AWS_REGION'];
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await provider.chat(makeRequest());

    expect(BedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({region: 'us-east-1'}),
    );
  });

  it('should use config region over env', async () => {
    const {BedrockRuntimeClient} = await import('@aws-sdk/client-bedrock-runtime');

    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test', region: 'eu-west-1'});
    await provider.chat(makeRequest());

    expect(BedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({region: 'eu-west-1'}),
    );
  });

  it('should return text response', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'Hello!'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 10, outputTokens: 5},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([{type: 'text', text: 'Hello!'}]);
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({inputTokens: 10, outputTokens: 5});
  });

  it('should return tool use response', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            {toolUse: {toolUseId: 'tc-1', name: 'request', input: {url: '/api'}}},
          ],
        },
      },
      stopReason: 'tool_use',
      usage: {inputTokens: 20, outputTokens: 15},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toEqual([
      {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
    ]);
    expect(response.stopReason).toBe('tool_use');
  });

  it('should return mixed text and tool use', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            {text: 'Let me check.'},
            {toolUse: {toolUseId: 'tc-1', name: 'request', input: {}}},
          ],
        },
      },
      stopReason: 'tool_use',
      usage: {inputTokens: 30, outputTokens: 20},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    const response = await provider.chat(makeRequest());

    expect(response.content).toHaveLength(2);
    expect(response.content[0]?.type).toBe('text');
    expect(response.content[1]?.type).toBe('tool_use');
  });

  it('should pass system prompt in system field', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await provider.chat(makeRequest({systemPrompt: 'Be concise.'}));

    const commandInstance = mockSend.mock.calls[0]?.[0];
    expect(commandInstance.input.system).toEqual([{text: 'Be concise.'}]);
  });

  it('should convert tool definitions to toolConfig', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await provider.chat(
      makeRequest({
        tools: [{name: 'my_tool', description: 'does stuff', parameters: {type: 'object'}}],
      }),
    );

    const commandInstance = mockSend.mock.calls[0]?.[0];
    expect(commandInstance.input.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: 'my_tool',
            description: 'does stuff',
            inputSchema: {json: {type: 'object'}},
          },
        },
      ],
    });
  });

  it('should convert message history with tool results', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
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

    const commandInstance = mockSend.mock.calls[0]?.[0];
    const callArgs = commandInstance.input;
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[1].role).toBe('assistant');
    expect(callArgs.messages[2].role).toBe('user'); // tool result
    expect(callArgs.messages[2].content[0].toolResult.toolUseId).toBe('tc-1');
  });

  it('should pass error status on tool result with isError', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'ok'}]}},
      stopReason: 'end_turn',
      usage: {inputTokens: 5, outputTokens: 3},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await provider.chat(
      makeRequest({
        messages: [
          {role: 'user', content: 'hello'},
          {role: 'assistant', content: [{type: 'tool_use', id: 'tc-1', name: 'request', input: {}}]},
          {role: 'tool_result', toolCallId: 'tc-1', content: 'failed', isError: true},
        ],
      }),
    );

    const commandInstance = mockSend.mock.calls[0]?.[0];
    const callArgs = commandInstance.input;
    expect(callArgs.messages[2].content[0].toolResult.status).toBe('error');
  });

  it('should throw RateLimitError on 429', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Too many requests'), {
        $metadata: {httpStatusCode: 429},
      }),
    );

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw RateLimitError on ThrottlingException', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Rate exceeded'), {
        name: 'ThrottlingException',
        $metadata: {httpStatusCode: 400},
      }),
    );

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(RateLimitError);
  });

  it('should throw ProviderTimeoutError on timeout', async () => {
    mockSend.mockRejectedValue(new Error('Request timeout'));

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    await expect(provider.chat(makeRequest())).rejects.toThrow(ProviderTimeoutError);
  });

  it('should mark 5xx as retryable', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Internal error'), {
        $metadata: {httpStatusCode: 500},
      }),
    );

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    try {
      await provider.chat(makeRequest());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
       
      expect((err as ProviderError).retryable).toBe(true);
    }
  });

  it('should map max_tokens stop reason', async () => {
    mockSend.mockResolvedValue({
      output: {message: {content: [{text: 'partial'}]}},
      stopReason: 'max_tokens',
      usage: {inputTokens: 5, outputTokens: 4096},
    });

    const provider = new BedrockRuntimeProvider({provider: 'bedrock', model: 'test'});
    const response = await provider.chat(makeRequest());
    expect(response.stopReason).toBe('max_tokens');
  });
});
