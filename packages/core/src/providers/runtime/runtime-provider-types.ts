/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Re-export LLM types from the shared types package.
export type {
  LLMChatRequest,
  LLMMessage,
  LLMUserMessage,
  LLMUserContentPart,
  LLMUserImagePart,
  LLMAssistantMessage,
  LLMToolResultMessage,
  LLMChatResponse,
  LLMUsage,
  LLMResponseBlock,
  LLMTextBlock,
  LLMToolUseBlock,
  LLMToolDefinition,
  RuntimeProvider,
} from '@amodalai/types';

import type {LLMUserImagePart} from '@amodalai/types';

/**
 * Normalize an image content part that may use either our LLMUserImagePart
 * field names (data, mimeType) or the Vercel AI SDK ImagePart field names
 * (image, mediaType). Returns consistent {data, mimeType} values.
 *
 * At runtime the part object may carry AI SDK fields that don't exist on
 * our LLMUserImagePart type, so we index into it dynamically.
 */
/**
 * AI SDK ImagePart shape — not imported to avoid adding ai as a dependency to core.
 * Only used for the type guard below.
 */
interface AISDKImagePart {
  type: 'image';
  image: string;
  mediaType?: string;
}

function isAISDKImagePart(part: unknown): part is AISDKImagePart {
  if (typeof part !== 'object' || part === null || !('image' in part)) return false;
  // `in` narrows to `object & Record<'image', unknown>` — safe to access `.image`
  return typeof part.image === 'string';
}

export function normalizeImagePart(part: LLMUserImagePart): {data: string; mimeType: string} {
  // Our LLMUserImagePart has `data` + `mimeType`; AI SDK's ImagePart has
  // `image` + `mediaType`. At runtime both shapes flow through the same
  // message array, so we detect which shape we actually received.
  if (part.data && part.mimeType) return {data: part.data, mimeType: part.mimeType};
  if (isAISDKImagePart(part)) {
    return {data: part.image, mimeType: part.mediaType ?? 'image/png'};
  }
  return {data: part.data ?? '', mimeType: part.mimeType ?? 'image/png'};
}
