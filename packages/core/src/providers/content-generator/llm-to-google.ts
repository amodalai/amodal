/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Converts our provider-neutral LLM types (LLMChatResponse, LLMStreamEvent)
 * back into Google @google/genai types (GenerateContentResponse).
 *
 * This is the "output" side of the ContentGenerator adapter — it translates
 * responses from our RuntimeProvider implementations into the format that
 * the upstream GeminiClient expects.
 */

import type { LLMChatResponse, LLMResponseBlock } from '../runtime/runtime-provider-types.js';
import type { LLMStreamEvent } from '../runtime/streaming-types.js';

// ---------------------------------------------------------------------------
// Google response type aliases (structural)
// ---------------------------------------------------------------------------

interface GContent {
  role?: string;
  parts?: GPart[];
}

interface GPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  [key: string]: unknown;
}

interface GCandidate {
  content?: GContent;
  finishReason?: string;
  index?: number;
}

interface GUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

/**
 * Structural match for GenerateContentResponse.
 * We construct plain objects matching this shape and cast to the real class.
 */
export interface GGenerateContentResponse {
  candidates?: GCandidate[];
  usageMetadata?: GUsageMetadata;
  responseId?: string;
}

// ---------------------------------------------------------------------------
// Non-streaming conversion
// ---------------------------------------------------------------------------

/**
 * Convert an LLMChatResponse to a GenerateContentResponse.
 */
export function convertLLMResponse(response: LLMChatResponse): GGenerateContentResponse {
  const parts = response.content.map(blockToPart);

  const result: GGenerateContentResponse = {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: mapFinishReason(response.stopReason),
        index: 0,
      },
    ],
  };

  if (response.usage) {
    const allInput = response.usage.inputTokens
      + (response.usage.cacheReadInputTokens ?? 0)
      + (response.usage.cacheCreationInputTokens ?? 0);
    result.usageMetadata = {
      promptTokenCount: allInput,
      candidatesTokenCount: response.usage.outputTokens,
      totalTokenCount: allInput + response.usage.outputTokens,
      cachedContentTokenCount: response.usage.cacheReadInputTokens,
    };
  }

  attachFunctionCallsGetter(result);
  return result;
}

// ---------------------------------------------------------------------------
// Streaming conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single LLMStreamEvent into a GenerateContentResponse chunk.
 *
 * Returns null for events that should be skipped (e.g., tool_use_delta
 * which is accumulated by the caller).
 */
export function convertStreamEvent(event: LLMStreamEvent): GGenerateContentResponse | null {
  let chunk: GGenerateContentResponse | null;

  switch (event.type) {
    case 'text_delta':
      chunk = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: event.text }],
            },
            index: 0,
          },
        ],
      };
      break;

    case 'tool_use_start':
      // Skip — we'll emit the complete function call on tool_use_end.
      // The caller must track the name from this event.
      return null;

    case 'tool_use_delta':
      // Skip — deltas are accumulated by the provider; args come in tool_use_end
      return null;

    case 'tool_use_end':
      // Emit the complete function call with parsed args.
      // The caller should have set the name from tool_use_start via toolNameMap.
      chunk = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: event.id,
                    name: '', // Caller must patch this with the name from tool_use_start
                    args: event.input,
                  },
                },
              ],
            },
            index: 0,
          },
        ],
      };
      break;

    case 'message_end':
      chunk = {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason: mapFinishReason(event.stopReason),
            index: 0,
          },
        ],
      };
      if (event.usage) {
        const allInput = event.usage.inputTokens
          + (event.usage.cacheReadInputTokens ?? 0)
          + (event.usage.cacheCreationInputTokens ?? 0);
        chunk.usageMetadata = {
          promptTokenCount: allInput,
          candidatesTokenCount: event.usage.outputTokens,
          totalTokenCount: allInput + event.usage.outputTokens,
          cachedContentTokenCount: event.usage.cacheReadInputTokens,
        };
      }
      break;

    default:
      return null;
  }

  if (chunk) {
    attachFunctionCallsGetter(chunk);
  }
  return chunk;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attach a `functionCalls` getter to a response object.
 *
 * The upstream GeminiChat uses `resp.functionCalls` (a class getter) to extract
 * function calls from responses. Our plain objects don't have this getter,
 * so we must add it manually.
 */
function attachFunctionCallsGetter(resp: GGenerateContentResponse): void {
  Object.defineProperty(resp, 'functionCalls', {
    get() {
      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts) return undefined;
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => p.functionCall!);  
      return calls.length > 0 ? calls : undefined;
    },
    enumerable: false,
    configurable: true,
  });

  // Also add `text` getter used by some upstream code
  Object.defineProperty(resp, 'text', {
    get() {
      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts) return undefined;
      const texts = parts.filter((p) => p.text).map((p) => p.text);
      return texts.length > 0 ? texts.join('') : undefined;
    },
    enumerable: false,
    configurable: true,
  });
}

function blockToPart(block: LLMResponseBlock): GPart {
  if (block.type === 'text') {
    return { text: block.text };
  }
  // tool_use
  return {
    functionCall: {
      id: block.id,
      name: block.name,
      args: block.input,
    },
  };
}

function mapFinishReason(
  stopReason: LLMChatResponse['stopReason'],
): string {
  switch (stopReason) {
    case 'end_turn':
      return 'STOP';
    case 'tool_use':
      return 'STOP';
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'error':
      return 'FINISH_REASON_UNSPECIFIED';
    default:
      return 'STOP';
  }
}
