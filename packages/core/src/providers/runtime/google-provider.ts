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
 * RuntimeProvider backed by the Google Gemini API via @google/genai SDK.
 */
export class GoogleRuntimeProvider implements RuntimeProvider {
  private readonly apiKey: string;

  constructor(config: ModelConfig) {
    const key = config.credentials?.['GOOGLE_API_KEY']
      ?? process.env['GOOGLE_API_KEY'];
    if (!key) {
      throw new ProviderError('GOOGLE_API_KEY is not set', {provider: 'google'});
    }
    this.apiKey = key;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const {GoogleGenAI} = await import('@google/genai');

    const client = new GoogleGenAI({apiKey: this.apiKey});

    const contents = convertMessages(request.messages);
    const tools = convertTools(request.tools);

    try {
      const response = await client.models.generateContent({
        model: request.model,
        contents,
        config: {
          systemInstruction: request.systemPrompt,
          maxOutputTokens: request.maxTokens ?? 4096,
          ...(tools.length > 0
            ? {tools: [{functionDeclarations: tools}]}
            : {}),
          ...(request.signal ? {abortSignal: request.signal} : {}),
        },
      });

      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: accessing Gemini response shape */
      const candidate = (response as unknown as GeminiResponse).candidates?.[0];
      const usageMetadata = (response as unknown as GeminiResponse).usageMetadata;
      /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

      if (!candidate) {
        throw new ProviderError('Google returned no candidates', {provider: 'google'});
      }

      return {
        content: convertResponseParts(candidate.content?.parts ?? []),
        stopReason: mapFinishReason(candidate.finishReason),
        usage: usageMetadata
          ? {
              inputTokens: usageMetadata.promptTokenCount ?? 0,
              outputTokens: usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  async *chatStream(request: LLMChatRequest): AsyncGenerator<LLMStreamEvent> {
    const {GoogleGenAI} = await import('@google/genai');

    const client = new GoogleGenAI({apiKey: this.apiKey});

    const contents = convertMessages(request.messages);
    const tools = convertTools(request.tools);

    try {
      const stream = await client.models.generateContentStream({
        model: request.model,
        contents,
        config: {
          systemInstruction: request.systemPrompt,
          maxOutputTokens: request.maxTokens ?? 4096,
          ...(tools.length > 0
            ? {tools: [{functionDeclarations: tools}]}
            : {}),
          ...(request.signal ? {abortSignal: request.signal} : {}),
        },
      });

      /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: stream chunks */
      for await (const chunk of stream as unknown as AsyncIterable<GeminiStreamChunk>) {
        const candidate = chunk.candidates?.[0];
        if (!candidate?.content?.parts) continue;

        for (const part of candidate.content.parts) {
          if (part.text !== undefined) {
            yield {type: 'text_delta', text: part.text};
          } else if (part.functionCall?.name) {
            const id = part.functionCall.id ?? `call_${part.functionCall.name}_${Date.now()}`;
            yield {type: 'tool_use_start', id, name: part.functionCall.name};
            const args = part.functionCall.args ?? {};
            const argsStr = JSON.stringify(args);
            yield {type: 'tool_use_delta', id, inputDelta: argsStr};
            yield {type: 'tool_use_end', id, input: args};
          }
        }

        if (candidate.finishReason) {
          yield {
            type: 'message_end',
            stopReason: mapFinishReason(candidate.finishReason),
            usage: chunk.usageMetadata
              ? {
                  inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                  outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
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

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {parts?: GeminiPart[]};
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Internal types for SDK response shape
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: {parts?: GeminiPart[]};
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface GeminiPart {
  text?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

function convertMessages(messages: LLMMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', parts: formatUserParts(msg.content)});
        break;

      case 'assistant':
        result.push({
          role: 'model',
          parts: msg.content.flatMap((block): Array<Record<string, unknown>> => {
            if (block.type === 'text') {
              return [{text: block.text}];
            }
            if (block.type === 'tool_use') {
              return [{
                functionCall: {
                  name: block.name,
                  args: block.input,
                },
              }];
            }
            if (block.type === 'image') {
              return [{inlineData: {mimeType: block.mimeType, data: block.data}}];
            }
            return [];
          }),
        });
        break;

      case 'tool_result':
        result.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: msg.toolCallId,
                name: msg.toolCallId,
                response: safeParseJson(msg.content),
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

function formatUserParts(
  content: string | LLMUserContentPart[],
): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{text: content}];
  return content.map((part) => {
    if (part.type === 'text') return {text: part.text};
    return {inlineData: {mimeType: part.mimeType, data: part.data}};
  });
}

function safeParseJson(content: string): Record<string, unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing tool result content
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return {result: content};
  } catch {
    return {result: content};
  }
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function convertTools(tools: LLMToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

function convertResponseParts(parts: GeminiPart[]): LLMResponseBlock[] {
  const result: LLMResponseBlock[] = [];
  for (const part of parts) {
    if (part.text !== undefined) {
      result.push({type: 'text', text: part.text});
    } else if (part.functionCall?.name) {
      result.push({
        type: 'tool_use',
        id: part.functionCall.id ?? `call_${part.functionCall.name}_${Date.now()}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    } else if (part.inlineData?.data) {
      result.push({
        type: 'image',
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      });
    }
  }
  return result;
}

function mapFinishReason(reason: string | undefined): LLMChatResponse['stopReason'] {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
  switch (reason) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'MALFORMED_FUNCTION_CALL':
    case 'UNEXPECTED_TOOL_CALL':
      return 'tool_use';
    default:
      // If there are function calls in the response, Gemini uses STOP
      // We check for tool_use at the content level instead
      return 'end_turn';
  }
}

function classifyError(err: unknown): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- classifying unknown SDK errors
  const errObj = err as {status?: number; message?: string; code?: number};
  const status = errObj.status ?? errObj.code;
  const message = errObj.message ?? String(err);

  if (status === 429) {
    return new RateLimitError(`Google rate limited: ${message}`, {
      provider: 'google',
      cause: err,
    });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new ProviderTimeoutError(`Google timeout: ${message}`, {
      provider: 'google',
      cause: err,
    });
  }

  const retryable = typeof status === 'number' && status >= 500;

  return new ProviderError(`Google error: ${message}`, {
    provider: 'google',
    statusCode: typeof status === 'number' ? status : undefined,
    retryable,
    cause: err,
  });
}
