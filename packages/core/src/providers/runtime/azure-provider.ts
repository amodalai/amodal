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
} from './runtime-provider-types.js';
import {ProviderError} from './provider-errors.js';

/**
 * RuntimeProvider for Azure OpenAI Service.
 *
 * Thin wrapper over OpenAIRuntimeProvider that sets up Azure-specific config:
 * - Base URL: `https://{resource}.openai.azure.com/openai/deployments/{deployment}`
 * - API key: reads AZURE_OPENAI_API_KEY
 * - API version query param is handled by the OpenAI SDK when `azureOpenAI` options are set
 *
 * The OpenAI SDK natively supports Azure via `AzureOpenAI` client.
 */
export class AzureOpenAIRuntimeProvider implements RuntimeProvider {
  private readonly apiKey: string;
  private readonly resourceName: string;
  private readonly deploymentName: string;
  private readonly apiVersion: string;

  constructor(config: ModelConfig) {
    const key = config.credentials?.['AZURE_OPENAI_API_KEY']
      ?? process.env['AZURE_OPENAI_API_KEY'];
    if (!key) {
      throw new ProviderError('AZURE_OPENAI_API_KEY is not set', {provider: 'azure'});
    }
    this.apiKey = key;

    const resource = config.credentials?.['AZURE_OPENAI_RESOURCE']
      ?? process.env['AZURE_OPENAI_RESOURCE']
      ?? '';
    if (!resource && !config.baseUrl) {
      throw new ProviderError(
        'AZURE_OPENAI_RESOURCE is not set and no baseUrl provided',
        {provider: 'azure'},
      );
    }
    this.resourceName = resource;
    this.deploymentName = config.model;
    this.apiVersion = config.credentials?.['AZURE_OPENAI_API_VERSION']
      ?? process.env['AZURE_OPENAI_API_VERSION']
      ?? '2024-10-21';
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    const {AzureOpenAI} = await import('openai');

    const client = new AzureOpenAI({
      apiKey: this.apiKey,
      endpoint: `https://${this.resourceName}.openai.azure.com`,
      deployment: this.deploymentName,
      apiVersion: this.apiVersion,
    });

    // Delegate to a helper provider that uses this pre-configured client
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AzureOpenAI SDK type mismatch
    return chatWithClient(client as unknown as AzureOpenAIClient, request);
  }
}

/**
 * Execute chat using a pre-configured OpenAI-compatible client.
 * Reuses the same conversion logic as OpenAIRuntimeProvider.
 */
async function chatWithClient(
  client: AzureOpenAIClient,
  request: LLMChatRequest,
): Promise<LLMChatResponse> {
  // We instantiate a temporary OpenAIRuntimeProvider just to reuse its
  // conversion logic. Instead, we directly build the request using the same
  // format as OpenAI.
  const messages = convertMessages(request.systemPrompt, request.messages);
  const tools = convertTools(request.tools);

  try {
    const response = await client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      ...(tools.length > 0 ? {tools} : {}),
      stream: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: Azure OpenAI response shape
    const completion = response as {
      choices: Array<{message: OpenAIChoiceMessage; finish_reason: string | null}>;
      usage?: {prompt_tokens: number; completion_tokens?: number};
    };

    const choice = completion.choices[0];
    if (!choice) {
      throw new ProviderError('Azure OpenAI returned no choices', {provider: 'azure'});
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AzureOpenAIClient {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<unknown>;
    };
  };
}

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

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChoiceMessage {
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {name: string; arguments: string};
  }>;
}

// ---------------------------------------------------------------------------
// Conversion helpers (mirror OpenAI provider)
// ---------------------------------------------------------------------------

import type {
  LLMMessage,
  LLMResponseBlock,
  LLMToolDefinition,
} from './runtime-provider-types.js';
import {RateLimitError, ProviderTimeoutError} from './provider-errors.js';

function convertMessages(systemPrompt: string, messages: LLMMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [{role: 'system', content: systemPrompt}];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        result.push({role: 'user', content: typeof msg.content === 'string' ? msg.content : msg.content.map((p) => p.type === 'text' ? {type: 'text', text: p.text} : {type: 'image_url', image_url: {url: `data:${p.mimeType};base64,${p.data}`}})});
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
    return new RateLimitError(`Azure OpenAI rate limited: ${message}`, {
      provider: 'azure',
      cause: err,
    });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new ProviderTimeoutError(`Azure OpenAI timeout: ${message}`, {
      provider: 'azure',
      cause: err,
    });
  }

  const retryable = typeof status === 'number' && status >= 500;

  return new ProviderError(`Azure OpenAI error: ${message}`, {
    provider: 'azure',
    statusCode: status,
    retryable,
    cause: err,
  });
}
