/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider round-trip integration tests.
 *
 * These make REAL API calls and require provider API keys.
 * Run manually or in CI with secrets configured.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY — for Anthropic tests
 *   OPENAI_API_KEY    — for OpenAI tests
 *   GOOGLE_API_KEY    — for Google tests
 *   DEEPSEEK_API_KEY  — for DeepSeek tests
 *
 * Run a single provider:
 *   pnpm --filter @amodalai/runtime vitest run src/__tests__/providers.test.ts -t "Anthropic"
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRuntimeProvider } from '@amodalai/core';
import type {
  LLMChatRequest,
  LLMStreamEvent,
  LLMToolDefinition,
  RuntimeProvider,
  LLMChatResponse,
} from '@amodalai/types';

// ---------------------------------------------------------------------------
// Shared test tool: a simple calculator the model can call
// ---------------------------------------------------------------------------

const calculatorTool: LLMToolDefinition = {
  name: 'calculate',
  description: 'Perform basic arithmetic. Returns the numeric result.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'subtract', 'multiply', 'divide'],
        description: 'The arithmetic operation to perform',
      },
      a: { type: 'number', description: 'First operand' },
      b: { type: 'number', description: 'Second operand' },
    },
    required: ['operation', 'a', 'b'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT = 60_000;

function makeTextRequest(model: string, prompt: string): LLMChatRequest {
  return {
    model,
    systemPrompt: 'You are a helpful assistant. Be concise.',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    maxTokens: 256,
    signal: AbortSignal.timeout(TIMEOUT),
  };
}

function makeToolRequest(model: string): LLMChatRequest {
  return {
    model,
    systemPrompt:
      'You are a helpful assistant. When asked to calculate something, ALWAYS use the calculate tool. Do not compute the answer yourself.',
    messages: [
      {
        role: 'user',
        content: 'What is 7 multiplied by 6? Use the calculate tool.',
      },
    ],
    tools: [calculatorTool],
    maxTokens: 256,
    signal: AbortSignal.timeout(TIMEOUT),
  };
}

async function collectStreamEvents(provider: RuntimeProvider, request: LLMChatRequest): Promise<LLMStreamEvent[]> {
  const events: LLMStreamEvent[] = [];
  if (!provider.chatStream) {
    throw new Error('Provider does not support chatStream');
  }
  for await (const event of provider.chatStream(request)) {
    events.push(event);
  }
  return events;
}

function assertTextResponse(response: LLMChatResponse): void {
  const textBlocks = response.content.filter((b) => b.type === 'text');
  expect(textBlocks.length).toBeGreaterThan(0);
  const fullText = textBlocks.map((b) => b.type === 'text' ? b.text : '').join('');
  expect(fullText.length).toBeGreaterThan(0);
}

function assertToolCallResponse(response: LLMChatResponse): void {
  const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
  expect(toolBlocks.length).toBeGreaterThan(0);

  const calcCall = toolBlocks.find(
    (b) => b.type === 'tool_use' && b.name === 'calculate',
  );
  expect(calcCall).toBeDefined();

  if (calcCall && calcCall.type === 'tool_use') {
    expect(calcCall.input).toBeDefined();
    expect(calcCall.input['operation']).toBe('multiply');
    expect(calcCall.input['a']).toBe(7);
    expect(calcCall.input['b']).toBe(6);
  }
}

function assertStreamHasText(events: LLMStreamEvent[]): void {
  const textDeltas = events.filter((e) => e.type === 'text_delta');
  expect(textDeltas.length).toBeGreaterThan(0);

  const fullText = textDeltas
    .map((e) => (e.type === 'text_delta' ? e.text : ''))
    .join('');
  expect(fullText.length).toBeGreaterThan(0);
}

function assertStreamHasToolCall(events: LLMStreamEvent[]): void {
  const toolStarts = events.filter((e) => e.type === 'tool_use_start');
  expect(toolStarts.length).toBeGreaterThan(0);

  const calcStart = toolStarts.find(
    (e) => e.type === 'tool_use_start' && e.name === 'calculate',
  );
  expect(calcStart).toBeDefined();

  const toolEnds = events.filter((e) => e.type === 'tool_use_end');
  expect(toolEnds.length).toBeGreaterThan(0);

  const calcEnd = toolEnds.find(
    (e) => e.type === 'tool_use_end' && e.input['operation'] === 'multiply',
  );
  expect(calcEnd).toBeDefined();
}

function assertStreamEndsCleanly(events: LLMStreamEvent[]): void {
  const endEvents = events.filter((e) => e.type === 'message_end');
  expect(endEvents.length).toBe(1);
  const end = endEvents[0];
  if (end && end.type === 'message_end') {
    expect(['end_turn', 'tool_use']).toContain(end.stopReason);
  }
}

function assertUsage(response: LLMChatResponse): void {
  expect(response.usage).toBeDefined();
  if (response.usage) {
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Provider test suite factory
// ---------------------------------------------------------------------------

function describeProvider(
  name: string,
  providerName: string,
  model: string,
  envVar: string,
) {
  const apiKey = process.env[envVar];
  const fn = apiKey ? describe : describe.skip;

  fn(`${name} (${model})`, () => {
    let provider: RuntimeProvider;

    beforeAll(() => {
      const credentials: Record<string, string> = {};
      // OpenAI-compatible providers (deepseek, groq, etc.) need the key as OPENAI_API_KEY
      // because the OpenAI provider constructor reads that field.
      // The factory normally handles this, but we pass credentials explicitly here.
      const openaiCompatible = ['deepseek', 'groq', 'mistral', 'xai'];
      if (openaiCompatible.includes(providerName)) {
        credentials['OPENAI_API_KEY'] = apiKey ?? '';
      } else {
        credentials[envVar] = apiKey ?? '';
      }

      provider = createRuntimeProvider({
        provider: providerName,
        model,
        credentials,
      });
    });

    describe('chat() — text response', () => {
      it(
        'returns a text response',
        async () => {
          const response = await provider.chat(
            makeTextRequest(model, 'What is the capital of France? Answer in one word.'),
          );
          assertTextResponse(response);
          assertUsage(response);

          const text = response.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('');
          expect(text.toLowerCase()).toContain('paris');
        },
        TIMEOUT,
      );
    });

    describe('chat() — tool call', () => {
      it(
        'calls the calculate tool with correct arguments',
        async () => {
          const response = await provider.chat(makeToolRequest(model));
          assertToolCallResponse(response);
        },
        TIMEOUT,
      );
    });

    describe('chatStream() — streaming text', () => {
      it(
        'streams text deltas and ends cleanly',
        async () => {
          if (!provider.chatStream) {
            return; // skip if no streaming support
          }
          const events = await collectStreamEvents(
            provider,
            makeTextRequest(model, 'What is the capital of France? Answer in one word.'),
          );
          assertStreamHasText(events);
          assertStreamEndsCleanly(events);
        },
        TIMEOUT,
      );
    });

    describe('chatStream() — streaming tool call', () => {
      it(
        'streams tool_use events with correct arguments',
        async () => {
          if (!provider.chatStream) {
            return; // skip if no streaming support
          }
          const events = await collectStreamEvents(
            provider,
            makeToolRequest(model),
          );
          assertStreamHasToolCall(events);
          assertStreamEndsCleanly(events);
        },
        TIMEOUT,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Provider test suites
// ---------------------------------------------------------------------------

describe('Provider Round-Trip Tests', () => {
  describeProvider(
    'Anthropic',
    'anthropic',
    'claude-sonnet-4-20250514',
    'ANTHROPIC_API_KEY',
  );

  describeProvider(
    'OpenAI',
    'openai',
    'gpt-4o-mini',
    'OPENAI_API_KEY',
  );

  describeProvider(
    'Google',
    'google',
    'gemini-2.5-flash',
    'GOOGLE_API_KEY',
  );

  describeProvider(
    'DeepSeek',
    'deepseek',
    'deepseek-chat',
    'DEEPSEEK_API_KEY',
  );

  describeProvider(
    'Groq',
    'groq',
    'llama-3.3-70b-versatile',
    'GROQ_API_KEY',
  );
});
