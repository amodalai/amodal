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

/** Default MIME type when an image part doesn't specify one. */
export const DEFAULT_IMAGE_MIME_TYPE = 'image/png';

/**
 * Normalize an image content part that may use either our LLMUserImagePart
 * field names (data, mimeType) or the Vercel AI SDK ImagePart field names
 * (image, mediaType). Returns consistent {data, mimeType} values.
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

export function normalizeImagePart(part: LLMUserImagePart | AISDKImagePart): {data: string; mimeType: string} {
  // Our LLMUserImagePart has `data` + `mimeType`; AI SDK's ImagePart has
  // `image` + `mediaType`. At runtime both shapes flow through the same
  // message array, so we detect which shape we actually received.
  if (isAISDKImagePart(part)) {
    return {data: part.image, mimeType: part.mediaType ?? DEFAULT_IMAGE_MIME_TYPE};
  }
  return {data: part.data ?? '', mimeType: part.mimeType ?? DEFAULT_IMAGE_MIME_TYPE};
}
