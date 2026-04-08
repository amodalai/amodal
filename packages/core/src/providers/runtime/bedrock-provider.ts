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
 * RuntimeProvider backed by the AWS Bedrock Converse API.
 *
 * Uses the unified Converse API which works across all Bedrock models.
 * Reads AWS credentials from the standard environment chain
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION).
 */
export class BedrockRuntimeProvider implements RuntimeProvider {
  private readonly region: string;
  private readonly credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };

  constructor(config: ModelConfig) {
    this.region = config.region
      ?? config.credentials?.['AWS_REGION']
      ?? process.env['AWS_REGION']
      ?? 'us-east-1';

    // Use explicit credentials if provided, otherwise SDK uses env/IAM chain
    const accessKeyId = config.credentials?.['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = config.credentials?.['AWS_SECRET_ACCESS_KEY'];
    if (accessKeyId && secretAccessKey) {
      this.credentials = {
        accessKeyId,
        secretAccessKey,
        sessionToken: config.credentials?.['AWS_SESSION_TOKEN'],
      };
    }
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const {BedrockRuntimeClient, ConverseCommand} = await import(
      '@aws-sdk/client-bedrock-runtime'
    );

    const client = new BedrockRuntimeClient({
      region: this.region,
      ...(this.credentials ? {credentials: this.credentials} : {}),
    });

    const messages = convertMessages(request.messages);
    const toolConfig = convertToolConfig(request.tools);

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: Bedrock type mismatch across versions
      const input = {
        modelId: request.model,
        system: [{text: request.systemPrompt}],
        messages,
        inferenceConfig: {
          maxTokens: request.maxTokens ?? 4096,
        },
        ...(toolConfig ? {toolConfig} : {}),
      } as unknown as ConstructorParameters<typeof ConverseCommand>[0];
      const command = new ConverseCommand(input);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: Bedrock response shape
      const response = (await client.send(command)) as unknown as BedrockConverseResponse;

      return {
        content: convertResponseContent(response.output?.message?.content ?? []),
        stopReason: mapStopReason(response.stopReason),
        usage: response.usage
          ? {
              inputTokens: response.usage.inputTokens ?? 0,
              outputTokens: response.usage.outputTokens ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  async *chatStream(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent> {
    const {BedrockRuntimeClient, ConverseStreamCommand} = await import(
      '@aws-sdk/client-bedrock-runtime'
    );

    const client = new BedrockRuntimeClient({
      region: this.region,
      ...(this.credentials ? {credentials: this.credentials} : {}),
    });

    const messages = convertMessages(request.messages);
    const toolConfig = convertToolConfig(request.tools);

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: Bedrock type mismatch across versions
      const streamInput = {
        modelId: request.model,
        system: [{text: request.systemPrompt}],
        messages,
        inferenceConfig: {
          maxTokens: request.maxTokens ?? 4096,
        },
        ...(toolConfig ? {toolConfig} : {}),
      } as unknown as ConstructorParameters<typeof ConverseStreamCommand>[0];
      const command = new ConverseStreamCommand(streamInput);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: Bedrock stream response
      const response = (await client.send(command)) as unknown as BedrockStreamResponse;

      if (!response.stream) {
        throw new ProviderError('Bedrock returned no stream', {provider: 'bedrock'});
      }

      const toolInputBuffers = new Map<string, string>();

      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: stream events */
      for await (const event of response.stream as unknown as AsyncIterable<BedrockStreamEvent>) {
        if (event.contentBlockStart?.start?.toolUse) {
          const tu = event.contentBlockStart.start.toolUse;
          const id = tu.toolUseId ?? '';
          toolInputBuffers.set(id, '');
          yield {type: 'tool_use_start', id, name: tu.name ?? ''};
        }

        if (event.contentBlockDelta?.delta) {
          const delta = event.contentBlockDelta.delta;
          if (delta.text) {
            yield {type: 'text_delta', text: delta.text};
          }
          if (delta.toolUse?.input) {
            // Find the current open tool
            const id = lastKey(toolInputBuffers);
            if (id) {
              const prev = toolInputBuffers.get(id) ?? '';
              toolInputBuffers.set(id, prev + delta.toolUse.input);
              yield {type: 'tool_use_delta', id, inputDelta: delta.toolUse.input};
            }
          }
        }

        if (event.contentBlockStop !== undefined) {
          // End the first open tool buffer
          for (const [id, jsonStr] of toolInputBuffers) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(jsonStr || '{}') as Record<string, unknown>;
            } catch {
              // Malformed
            }
            yield {type: 'tool_use_end', id, input};
            toolInputBuffers.delete(id);
            break;
          }
        }

        if (event.messageStop) {
          yield {
            type: 'message_end',
            stopReason: mapStopReason(event.messageStop.stopReason),
          };
        }

        if (event.metadata?.usage) {
          // Usage comes in metadata event after messageStop
          // Already yielded message_end above, usage won't be attached
        }
      }
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
    } catch (err) {
      throw classifyError(err);
    }
  }
}

function lastKey(map: Map<string, string>): string | undefined {
  let last: string | undefined;
  for (const k of map.keys()) {
    last = k;
  }
  return last;
}

interface BedrockStreamResponse {
  stream?: AsyncIterable<BedrockStreamEvent>;
}

interface BedrockStreamEvent {
  contentBlockStart?: {
    start?: {
      toolUse?: {toolUseId?: string; name?: string};
    };
  };
  contentBlockDelta?: {
    delta?: {
      text?: string;
      toolUse?: {input?: string};
    };
  };
  contentBlockStop?: Record<string, unknown>;
  messageStop?: {stopReason?: string};
  metadata?: {usage?: {inputTokens?: number; outputTokens?: number}};
}

// ---------------------------------------------------------------------------
// Internal types for Bedrock Converse API response shape
// ---------------------------------------------------------------------------

interface BedrockConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: BedrockContentBlock[];
    };
  };
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

interface BedrockContentBlock {
  text?: string;
  toolUse?: {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
}

function convertMessages(messages: LLMMessage[]): BedrockMessage[] {
  const result: BedrockMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', content: formatUserContent(msg.content)});
        break;

      case 'assistant':
        result.push({
          role: 'assistant',
          content: msg.content.flatMap((block): Array<Record<string, unknown>> => {
            if (block.type === 'text') {
              return [{text: block.text}];
            }
            if (block.type === 'tool_use') {
              return [{
                toolUse: {
                  toolUseId: block.id,
                  name: block.name,
                  input: block.input,
                },
              }];
            }
            // Skip image blocks — Bedrock doesn't support inline images in assistant messages
            return [];
          }),
        });
        break;

      case 'tool_result':
        result.push({
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: msg.toolCallId,
                content: [{text: msg.content}],
                ...(msg.isError ? {status: 'error'} : {}),
              },
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
): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{text: content}];
  return content.map((part) => {
    if (part.type === 'text') return {text: part.text};
    return {
      image: {
        format: part.mimeType.split('/')[1],
        source: {bytes: Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0))},
      },
    };
  });
}

interface BedrockToolConfig {
  tools: Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: {json: Record<string, unknown>};
    };
  }>;
}

function convertToolConfig(tools: LLMToolDefinition[]): BedrockToolConfig | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  return {
    tools: tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {json: t.parameters},
      },
    })),
  };
}

function convertResponseContent(blocks: BedrockContentBlock[]): LLMResponseBlock[] {
  const result: LLMResponseBlock[] = [];
  for (const block of blocks) {
    if (block.text !== undefined) {
      result.push({type: 'text', text: block.text});
    } else if (block.toolUse) {
      result.push({
        type: 'tool_use',
        id: block.toolUse.toolUseId,
        name: block.toolUse.name,
        input: block.toolUse.input ?? {},
      });
    }
  }
  return result;
}

function mapStopReason(reason: string | undefined): LLMChatResponse['stopReason'] {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
  switch (reason) {
    case 'end_turn':
    case 'stop':
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
  const errObj = err as {
    name?: string;
    $metadata?: {httpStatusCode?: number};
    message?: string;
  };
  const status = errObj.$metadata?.httpStatusCode;
  const message = errObj.message ?? String(err);
  const errorName = errObj.name ?? '';

  if (status === 429 || errorName === 'ThrottlingException') {
    return new RateLimitError(`Bedrock rate limited: ${message}`, {
      provider: 'bedrock',
      cause: err,
    });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT') || errorName === 'TimeoutError') {
    return new ProviderTimeoutError(`Bedrock timeout: ${message}`, {
      provider: 'bedrock',
      cause: err,
    });
  }

  const retryable = typeof status === 'number' && status >= 500;

  return new ProviderError(`Bedrock error: ${message}`, {
    provider: 'bedrock',
    statusCode: status,
    retryable,
    cause: err,
  });
}
