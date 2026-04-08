/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ModelConfig} from '../../repo/config-schema.js';
import type {
  RuntimeProvider,
  LLMChatRequest,
  LLMChatResponse,
  LLMMessage,
  LLMResponseBlock,
  LLMToolDefinition,
  LLMUserContentPart,
} from './runtime-provider-types.js';
import type {LLMStreamEvent} from './streaming-types.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';

/**
 * RuntimeProvider backed by the OpenAI Chat Completions API.
 *
 * Also serves as the provider for OpenAI-compatible endpoints (vLLM, Ollama,
 * Together, Groq, etc.) via `config.baseUrl`.
 */
export class OpenAIRuntimeProvider implements RuntimeProvider {
  private readonly apiKey: string;
  private readonly baseUrl?: string;

  constructor(config: ModelConfig) {
    const key = config.credentials?.['OPENAI_API_KEY']
      ?? process.env['OPENAI_API_KEY']
      ?? '';
    // OpenAI-compatible endpoints may not require a key
    if (!key && !config.baseUrl) {
      throw new ProviderError('OPENAI_API_KEY is not set', {provider: 'openai'});
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const {default: OpenAI} = await import('openai');

    const client = new OpenAI({
      apiKey: this.apiKey || 'not-needed',
      ...(this.baseUrl ? {baseURL: this.baseUrl} : {}),
    });

    const messages = convertMessages(request.systemPrompt, request.messages);
    const tools = convertTools(request.tools);

    try {
      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: our message/tool types map to OpenAI SDK types */
      const response = await client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        messages: messages as unknown as Parameters<typeof client.chat.completions.create>[0]['messages'],
        ...(tools.length > 0
          ? {tools: tools as unknown as Parameters<typeof client.chat.completions.create>[0]['tools']}
          : {}),
        stream: false,
      });

      const completion = response as unknown as {
        choices: Array<{message: OpenAIChoiceMessage; finish_reason: string | null}>;
        usage?: {prompt_tokens: number; completion_tokens?: number};
      };
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

      const choice = completion.choices[0];
      if (!choice) {
        throw new ProviderError('OpenAI returned no choices', {provider: 'openai'});
      }

      return {
        content: convertResponseContent(choice.message),
        stopReason: mapFinishReason(choice.finish_reason),
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  async *chatStream(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent> {
    const {default: OpenAI} = await import('openai');

    const client = new OpenAI({
      apiKey: this.apiKey || 'not-needed',
      ...(this.baseUrl ? {baseURL: this.baseUrl} : {}),
    });

    const messages = convertMessages(request.systemPrompt, request.messages);
    const tools = convertTools(request.tools);

    try {
      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: stream chunks */
      const stream = await client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        messages: messages as unknown as Parameters<typeof client.chat.completions.create>[0]['messages'],
        ...(tools.length > 0
          ? {tools: tools as unknown as Parameters<typeof client.chat.completions.create>[0]['tools']}
          : {}),
        stream: true,
      });

      const toolInputBuffers = new Map<string, string>();

      for await (const chunk of stream as unknown as AsyncIterable<OpenAIStreamChunk>) {
        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;

        if (delta?.content) {
          yield {type: 'text_delta', text: delta.content};
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const id = tc.id;
            if (id && tc.function?.name) {
              toolInputBuffers.set(id, '');
              yield {type: 'tool_use_start', id, name: tc.function.name};
            }

            if (tc.function?.arguments) {
              // Find the tool call id — may be in tc.id or from prior chunk
              const callId = tc.id ?? findToolIdByIndex(toolInputBuffers, tc.index);
              if (callId) {
                const prev = toolInputBuffers.get(callId) ?? '';
                toolInputBuffers.set(callId, prev + tc.function.arguments);
                yield {type: 'tool_use_delta', id: callId, inputDelta: tc.function.arguments};
              }
            }
          }
        }

        if (finishReason) {
          // End all open tool calls
          for (const [id, jsonStr] of toolInputBuffers) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(jsonStr || '{}') as Record<string, unknown>;
            } catch {
              // Malformed — pass empty
            }
            yield {type: 'tool_use_end', id, input};
          }
          toolInputBuffers.clear();

          yield {
            type: 'message_end',
            stopReason: mapFinishReason(finishReason),
            usage: chunk.usage
              ? {
                  inputTokens: chunk.usage.prompt_tokens ?? 0,
                  outputTokens: chunk.usage.completion_tokens ?? 0,
                }
              : undefined,
          };
        }
      }
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
    } catch (err) {
      throw classifyError(err);
    }
  }
}

function findToolIdByIndex(buffers: Map<string, string>, index?: number): string | undefined {
  if (index === undefined) return undefined;
  let i = 0;
  for (const id of buffers.keys()) {
    if (i === index) return id;
    i++;
  }
  return undefined;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {name?: string; arguments?: string};
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {prompt_tokens?: number; completion_tokens?: number};
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null | Array<Record<string, unknown>>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {name: string; arguments: string};
  }>;
  tool_call_id?: string;
}

function convertMessages(systemPrompt: string, messages: LLMMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [{role: 'system', content: systemPrompt}];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', content: formatUserContent(msg.content)});
        break;

      case 'assistant': {
        const textParts = msg.content.filter((b) => b.type === 'text');
        const toolParts = msg.content.filter((b) => b.type === 'tool_use');
        const content = textParts.map((b) => b.text).join('') || null;
        const toolCalls =
          toolParts.length > 0
            ? toolParts.map((b) => ({
                id: b.id,
                type: 'function' as const,
                function: {
                  name: b.name,
                  arguments: JSON.stringify(b.input),
                },
              }))
            : undefined;
        result.push({role: 'assistant', content, tool_calls: toolCalls});
        break;
      }

      case 'tool_result':
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        });
        break;

      default:
        break;
    }
  }

  return result;
}

function formatUserContent(
  content: string | LLMUserContentPart[],
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return {type: 'text', text: part.text};
    return {
      type: 'image_url',
      image_url: {url: `data:${part.mimeType};base64,${part.data}`},
    };
  });
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function convertTools(tools: LLMToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

interface OpenAIChoiceMessage {
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {name: string; arguments: string};
  }>;
}

function convertResponseContent(message: OpenAIChoiceMessage): LLMResponseBlock[] {
  const blocks: LLMResponseBlock[] = [];

  if (message.content) {
    blocks.push({type: 'text', text: message.content});
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: parsing JSON args
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        // Malformed JSON — pass empty input
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  return blocks;
}

function mapFinishReason(reason: string | null): LLMChatResponse['stopReason'] {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

function classifyError(err: unknown): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- classifying unknown SDK errors
  const errObj = err as {status?: number; message?: string};
  const status = errObj.status;
  const message = errObj.message ?? String(err);

  if (status === 429) {
    return new RateLimitError(`OpenAI rate limited: ${message}`, {
      provider: 'openai',
      cause: err,
    });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new ProviderTimeoutError(`OpenAI timeout: ${message}`, {
      provider: 'openai',
      cause: err,
    });
  }

  const retryable = typeof status === 'number' && status >= 500;

  return new ProviderError(`OpenAI error: ${message}`, {
    provider: 'openai',
    statusCode: status,
    retryable,
    cause: err,
  });
}
