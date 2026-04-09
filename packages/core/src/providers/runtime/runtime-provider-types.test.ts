/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {
  RuntimeProvider,
  LLMChatRequest,
  LLMChatResponse,
  LLMMessage,
  LLMUserMessage,
  LLMAssistantMessage,
  LLMToolResultMessage,
  LLMResponseBlock,
  LLMTextBlock,
  LLMToolUseBlock,
  LLMToolDefinition,
} from './runtime-provider-types.js';
import {normalizeImagePart, DEFAULT_IMAGE_MIME_TYPE} from './runtime-provider-types.js';

describe('runtime-provider-types', () => {
  it('should allow constructing a user message', () => {
    const msg: LLMUserMessage = {role: 'user', content: 'hello'};
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('should allow constructing an assistant message with text blocks', () => {
    const msg: LLMAssistantMessage = {
      role: 'assistant',
      content: [{type: 'text', text: 'Hi there!'}],
    };
    expect(msg.role).toBe('assistant');
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]?.type).toBe('text');
  });

  it('should allow constructing an assistant message with tool use blocks', () => {
    const msg: LLMAssistantMessage = {
      role: 'assistant',
      content: [
        {type: 'tool_use', id: 'tc-1', name: 'request', input: {url: '/api'}},
      ],
    };
    expect(msg.content[0]?.type).toBe('tool_use');
  });

  it('should allow constructing a tool result message', () => {
    const msg: LLMToolResultMessage = {
      role: 'tool_result',
      toolCallId: 'tc-1',
      content: '{"status": "ok"}',
      isError: false,
    };
    expect(msg.role).toBe('tool_result');
    expect(msg.toolCallId).toBe('tc-1');
  });

  it('should allow mixed message arrays', () => {
    const messages: LLMMessage[] = [
      {role: 'user', content: 'hello'},
      {role: 'assistant', content: [{type: 'text', text: 'Hi'}]},
      {role: 'tool_result', toolCallId: 'tc-1', content: 'done'},
    ];
    expect(messages).toHaveLength(3);
  });

  it('should allow constructing response blocks', () => {
    const text: LLMTextBlock = {type: 'text', text: 'hello'};
    const tool: LLMToolUseBlock = {type: 'tool_use', id: '1', name: 'fn', input: {}};
    const blocks: LLMResponseBlock[] = [text, tool];
    expect(blocks).toHaveLength(2);
  });

  it('should allow constructing a tool definition', () => {
    const def: LLMToolDefinition = {
      name: 'request',
      description: 'HTTP request',
      parameters: {type: 'object', properties: {}},
    };
    expect(def.name).toBe('request');
  });

  it('should allow constructing a chat request', () => {
    const req: LLMChatRequest = {
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are helpful.',
      messages: [{role: 'user', content: 'hi'}],
      tools: [],
      maxTokens: 4096,
    };
    expect(req.model).toBe('claude-sonnet-4-20250514');
  });

  it('should allow constructing a chat response', () => {
    const resp: LLMChatResponse = {
      content: [{type: 'text', text: 'Hello!'}],
      stopReason: 'end_turn',
      usage: {inputTokens: 100, outputTokens: 50},
    };
    expect(resp.stopReason).toBe('end_turn');
  });

  it('should allow implementing RuntimeProvider interface', () => {
    const provider: RuntimeProvider = {
      async chat(_req: LLMChatRequest): Promise<LLMChatResponse> {
        return {content: [], stopReason: 'end_turn'};
      },
    };
    expect(provider.chat).toBeDefined();
  });
});

describe('normalizeImagePart', () => {
  it('should pass through LLMUserImagePart fields', () => {
    const result = normalizeImagePart({type: 'image', mimeType: 'image/jpeg', data: 'abc123'});
    expect(result).toEqual({data: 'abc123', mimeType: 'image/jpeg'});
  });

  it('should normalize AI SDK ImagePart fields', () => {
    // AI SDK uses `image` + `mediaType` instead of `data` + `mimeType`
    const aiSdkPart = {type: 'image' as const, image: 'xyz789', mediaType: 'image/webp'};
    const result = normalizeImagePart(aiSdkPart);
    expect(result).toEqual({data: 'xyz789', mimeType: 'image/webp'});
  });

  it('should default mimeType for AI SDK parts without mediaType', () => {
    const aiSdkPart = {type: 'image' as const, image: 'abc'};
    const result = normalizeImagePart(aiSdkPart);
    expect(result).toEqual({data: 'abc', mimeType: DEFAULT_IMAGE_MIME_TYPE});
  });

  it('should default mimeType for LLM parts with empty mimeType', () => {
     
    const part = {type: 'image' as const, data: 'abc', mimeType: undefined} as unknown as Parameters<typeof normalizeImagePart>[0];
    const result = normalizeImagePart(part);
    expect(result.mimeType).toBe(DEFAULT_IMAGE_MIME_TYPE);
  });
});
