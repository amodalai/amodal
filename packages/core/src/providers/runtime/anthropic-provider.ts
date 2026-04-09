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
  LLMUsage,
  LLMUserContentPart,
} from './runtime-provider-types.js';
import {normalizeImagePart} from './runtime-provider-types.js';
import type {LLMStreamEvent} from './streaming-types.js';
import {ProviderError, RateLimitError, ProviderTimeoutError} from './provider-errors.js';

/**
 * RuntimeProvider backed by the Anthropic Messages API.
 */
export class AnthropicRuntimeProvider implements RuntimeProvider {
  private readonly apiKey: string;
  private readonly baseUrl?: string;

  constructor(config: ModelConfig) {
    const key = config.credentials?.['ANTHROPIC_API_KEY']
      ?? process.env['ANTHROPIC_API_KEY']
      ?? (config.baseUrl ? '' : undefined);
    if (!key && key !== '') {
      throw new ProviderError('ANTHROPIC_API_KEY is not set', {provider: 'anthropic'});
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const {default: Anthropic} = await import('@anthropic-ai/sdk');

    const client = new Anthropic({
      apiKey: this.apiKey,
      ...(this.baseUrl ? {baseURL: this.baseUrl} : {}),
    });

    const messages = convertMessages(request.messages);
    const tools = convertTools(request.tools);
    const system = buildCachedSystem(request.systemPrompt);
    const cachedTools = applyCacheControlToTools(tools);

    try {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: system content block array
        system: system as unknown as Parameters<typeof client.messages.create>[0]['system'],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: our AnthropicMessage[] maps to MessageParam[]
        messages: messages as unknown as Parameters<typeof client.messages.create>[0]['messages'],
        ...(cachedTools.length > 0
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: our AnthropicTool[] maps to ToolUnion[]
          ? {tools: cachedTools as unknown as Parameters<typeof client.messages.create>[0]['tools']}
          : {}),
      });

      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: non-streaming response shape */
      const msg = response as unknown as {
        content: AnthropicContentBlock[];
        stop_reason: string | null;
        usage: AnthropicUsage;
      };
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

      return {
        content: convertResponseBlocks(msg.content),
        stopReason: mapStopReason(msg.stop_reason),
        usage: extractUsage(msg.usage),
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  async *chatStream(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent> {
    const {default: Anthropic} = await import('@anthropic-ai/sdk');

    const client = new Anthropic({
      apiKey: this.apiKey,
      ...(this.baseUrl ? {baseURL: this.baseUrl} : {}),
    });

    const messages = convertMessages(request.messages);
    const tools = convertTools(request.tools);
    const system = buildCachedSystem(request.systemPrompt);
    const cachedTools = applyCacheControlToTools(tools);

    try {
      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: stream events */
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        system: system as unknown as Parameters<typeof client.messages.create>[0]['system'],
        messages: messages as unknown as Parameters<typeof client.messages.create>[0]['messages'],
        ...(cachedTools.length > 0
          ? {tools: cachedTools as unknown as Parameters<typeof client.messages.create>[0]['tools']}
          : {}),
      });

      const toolInputBuffers = new Map<string, string>();
      // Anthropic sends input token counts (including cache fields) in
      // message_start, and output token counts in message_delta. We
      // accumulate both and emit a single message_end with the full picture.
      let streamUsage: LLMUsage = {inputTokens: 0, outputTokens: 0};

      for await (const event of stream as unknown as AsyncIterable<AnthropicStreamEvent>) {
        switch (event.type) {
          case 'message_start': {
            // Capture input tokens + cache fields from message_start
            const u = event.message?.usage;
            if (u) {
              streamUsage = extractUsage(u);
            }
            break;
          }

          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              const id = event.content_block.id ?? '';
              const name = event.content_block.name ?? '';
              toolInputBuffers.set(id, '');
              yield {type: 'tool_use_start', id, name};
            }
            break;

          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              yield {type: 'text_delta', text: event.delta.text};
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              const id = findCurrentToolId(toolInputBuffers);
              if (id) {
                const prev = toolInputBuffers.get(id) ?? '';
                toolInputBuffers.set(id, prev + event.delta.partial_json);
                yield {type: 'tool_use_delta', id, inputDelta: event.delta.partial_json};
              }
            }
            break;

          case 'content_block_stop': {
            // Find the last tool that hasn't been ended yet
            for (const [id, jsonStr] of toolInputBuffers) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(jsonStr || '{}') as Record<string, unknown>;
              } catch {
                // Malformed — pass empty
              }
              yield {type: 'tool_use_end', id, input};
              toolInputBuffers.delete(id);
              break; // Only end one per content_block_stop
            }
            break;
          }

          case 'message_delta':
            // message_delta carries output_tokens; merge with input counts from message_start
            if (event.usage) {
              streamUsage.outputTokens = event.usage.output_tokens ?? 0;
            }
            yield {
              type: 'message_end',
              stopReason: mapStopReason(event.delta?.stop_reason ?? null),
              usage: streamUsage,
            };
            break;

          default:
            break;
        }
      }
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
    } catch (err) {
      throw classifyError(err);
    }
  }
}

function findCurrentToolId(buffers: Map<string, string>): string | undefined {
  // Return the last key (most recently added tool)
  let lastId: string | undefined;
  for (const id of buffers.keys()) {
    lastId = id;
  }
  return lastId;
}

interface AnthropicStreamEvent {
  type: string;
  message?: {usage?: AnthropicUsage};
  content_block?: {type?: string; id?: string; name?: string};
  delta?: {type?: string; text?: string; partial_json?: string; stop_reason?: string | null};
  usage?: {input_tokens?: number; output_tokens?: number};
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ---------------------------------------------------------------------------
// Prompt caching helpers
// ---------------------------------------------------------------------------

/**
 * Convert a system prompt string into a content-block array with
 * `cache_control` on the last block. This tells Anthropic to cache
 * the system prompt prefix, giving 90% input cost savings on cache hits.
 */
function buildCachedSystem(systemPrompt: string): Array<{type: 'text'; text: string; cache_control: {type: 'ephemeral'}}> {
  return [{type: 'text', text: systemPrompt, cache_control: {type: 'ephemeral'}}];
}

/**
 * Add `cache_control` to the last tool definition so the full tool list
 * is included in the cached prefix.
 */
function applyCacheControlToTools(tools: AnthropicTool[]): Array<AnthropicTool & {cache_control?: {type: 'ephemeral'}}> {
  if (tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1
      ? {...t, cache_control: {type: 'ephemeral'}}
      : t,
  );
}

/**
 * Extract our LLMUsage from the Anthropic usage object, mapping cache fields.
 */
function extractUsage(u: AnthropicUsage): LLMUsage {
  const usage: LLMUsage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
  };
  if (u.cache_read_input_tokens) {
    usage.cacheReadInputTokens = u.cache_read_input_tokens;
  }
  if (u.cache_creation_input_tokens) {
    usage.cacheCreationInputTokens = u.cache_creation_input_tokens;
  }
  return usage;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

function convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', content: formatUserContent(msg.content)});
        break;

      case 'assistant':
        result.push({
          role: 'assistant',
          content: msg.content.flatMap((block): Array<Record<string, unknown>> => {
            switch (block.type) {
              case 'text': return [{type: 'text', text: block.text}];
              case 'tool_use': return [{type: 'tool_use', id: block.id, name: block.name, input: block.input}];
              case 'image': return []; // Anthropic doesn't support inline images in assistant messages
              default: { const _exhaustive: never = block; void _exhaustive; return []; }
            }
          }),
        });
        break;

      case 'tool_result':
        // Anthropic requires tool results inside a user message
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
              ...(msg.isError ? {is_error: true} : {}),
            },
          ],
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
    const img = normalizeImagePart(part);
    return {
      type: 'image',
      source: {type: 'base64', media_type: img.mimeType, data: img.data},
    };
  });
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function convertTools(tools: LLMToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function convertResponseBlocks(blocks: AnthropicContentBlock[]): LLMResponseBlock[] {
  const result: LLMResponseBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text !== undefined) {
      result.push({type: 'text', text: block.text});
    } else if (block.type === 'tool_use' && block.id && block.name) {
      result.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      });
    }
  }
  return result;
}

function mapStopReason(reason: string | null): LLMChatResponse['stopReason'] {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
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
  const errObj = err as {status?: number; message?: string; error?: {type?: string}};
  const status = errObj.status;
  const message = errObj.message ?? String(err);

  if (status === 429) {
    return new RateLimitError(`Anthropic rate limited: ${message}`, {
      provider: 'anthropic',
      cause: err,
    });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new ProviderTimeoutError(`Anthropic timeout: ${message}`, {
      provider: 'anthropic',
      cause: err,
    });
  }

  const retryable = typeof status === 'number' && status >= 500;

  return new ProviderError(`Anthropic error: ${message}`, {
    provider: 'anthropic',
    statusCode: status,
    retryable,
    cause: err,
  });
}
