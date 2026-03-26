/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Converts Google @google/genai types (GenerateContentParameters)
 * into our provider-neutral LLM types (LLMChatRequest).
 *
 * This is the "input" side of the ContentGenerator adapter — it translates
 * the request format that the upstream GeminiClient produces into what our
 * RuntimeProvider implementations expect.
 */

import { randomUUID } from 'node:crypto';
import type {
  LLMChatRequest,
  LLMMessage,
  LLMToolDefinition,
  LLMResponseBlock,
} from '../runtime/runtime-provider-types.js';

// ---------------------------------------------------------------------------
// Google type aliases (structural — avoids hard dependency on @google/genai)
// ---------------------------------------------------------------------------

/** @google/genai Content */
interface GContent {
  role?: string;
  parts?: GPart[];
}

/** @google/genai Part */
interface GPart {
  text?: string;
  functionCall?: GFunctionCall;
  functionResponse?: GFunctionResponse;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType?: string; data?: string };
  [key: string]: unknown;
}

/** @google/genai FunctionCall */
interface GFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

/** @google/genai FunctionResponse */
interface GFunctionResponse {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

/** @google/genai FunctionDeclaration */
interface GFunctionDeclaration {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  /** Upstream gemini-cli-core uses parametersJsonSchema instead of parameters */
  parametersJsonSchema?: Record<string, unknown>;
}

/** @google/genai Tool */
interface GTool {
  functionDeclarations?: GFunctionDeclaration[];
  [key: string]: unknown;
}

/** Subset of GenerateContentConfig we care about */
interface GGenerateContentConfig {
  systemInstruction?: unknown; // Content | Part[] | string
  tools?: unknown[]; // Tool[]
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  abortSignal?: AbortSignal;
  [key: string]: unknown;
}

/** Subset of GenerateContentParameters */
export interface GGenerateContentParams {
  model: string;
  contents: unknown; // ContentListUnion
  config?: GGenerateContentConfig;
}

// ---------------------------------------------------------------------------
// Public conversion function
// ---------------------------------------------------------------------------

/**
 * Convert a Google GenerateContentParameters into our LLMChatRequest.
 */
export function convertGenerateContentParams(
  request: GGenerateContentParams,
): LLMChatRequest {
  const contents = normalizeContents(request.contents);
  const messages = contentsToMessages(contents);
  const systemPrompt = extractSystemPrompt(request.config?.systemInstruction);
  const tools = extractTools(request.config?.tools);

  return {
    model: request.model,
    systemPrompt,
    messages,
    tools,
    maxTokens: request.config?.maxOutputTokens,
    signal: request.config?.abortSignal,
  };
}

// ---------------------------------------------------------------------------
// Content normalization
// ---------------------------------------------------------------------------

/**
 * Normalize ContentListUnion to Content[].
 *
 * ContentListUnion can be:
 * - Content (single object with role + parts)
 * - Content[] (array)
 * - string (bare text)
 * - Part (single part)
 * - Part[] (array of parts)
 */
export function normalizeContents(contents: unknown): GContent[] {
  if (!contents) return [];

  // String → single user message
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }

  // Array
  if (Array.isArray(contents)) {
    if (contents.length === 0) return [];

    // Check if first element looks like Content (has 'role' or 'parts')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
    const first = contents[0] as Record<string, unknown>;
    if (first && (typeof first['role'] === 'string' || Array.isArray(first['parts']))) {
      // Content[]
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
      return contents as GContent[];
    }

    // Part[] — wrap as single user message
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
    return [{ role: 'user', parts: contents as GPart[] }];
  }

  // Single object
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
  const obj = contents as Record<string, unknown>;
  if (typeof obj['role'] === 'string' || Array.isArray(obj['parts'])) {
    // Single Content
    return [contents as GContent];
  }

  // Single Part — wrap as user message
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
  return [{ role: 'user', parts: [contents as GPart] }];
}

// ---------------------------------------------------------------------------
// System prompt extraction
// ---------------------------------------------------------------------------

/**
 * Extract system prompt text from systemInstruction.
 * Can be a string, Content, or Part[].
 */
export function extractSystemPrompt(instruction: unknown): string {
  if (!instruction) return '';

  if (typeof instruction === 'string') return instruction;

  // Content with parts
  const content = instruction as GContent;
  if (Array.isArray(content.parts)) {
    return extractTextFromParts(content.parts);
  }

  // Part[] directly
  if (Array.isArray(instruction)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
    return extractTextFromParts(instruction as GPart[]);
  }

  // Single Part
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK content normalization
  const part = instruction as GPart;
  if (typeof part.text === 'string') return part.text;

  return '';
}

function extractTextFromParts(parts: GPart[]): string {
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Contents → Messages
// ---------------------------------------------------------------------------

/**
 * Convert Content[] to LLMMessage[].
 *
 * A single Content can produce multiple LLMMessages when it contains
 * both text parts and functionResponse parts (tool results).
 */
export function contentsToMessages(contents: GContent[]): LLMMessage[] {
  const messages: LLMMessage[] = [];

  for (const content of contents) {
    const parts = content.parts ?? [];
    const role = content.role ?? 'user';

    if (role === 'model') {
      // Model turn → assistant message with response blocks
      const blocks = partsToResponseBlocks(parts);
      if (blocks.length > 0) {
        messages.push({ role: 'assistant', content: blocks });
      }
    } else {
      // User turn — may contain text, functionResponse, or both
      const textParts = parts.filter(
        (p) => typeof p.text === 'string' && !p.thought && !p.functionResponse && !p.functionCall,
      );
      const functionResponses = parts.filter((p) => p.functionResponse);

      // Text parts → user message
      if (textParts.length > 0) {
        const text = textParts.map((p) => p.text).join('\n');
        messages.push({ role: 'user', content: text });
      }

      // Function responses → tool result messages
      for (const part of functionResponses) {
        const fr = part.functionResponse!;  
        messages.push({
          role: 'tool_result',
          toolCallId: fr.id ?? fr.name ?? randomUUID(),
          content: fr.response ? JSON.stringify(fr.response) : '',
          isError: false,
        });
      }

      // If no text and no function responses, but there are parts with text (including thoughts)
      // still send something so the conversation doesn't break
      if (textParts.length === 0 && functionResponses.length === 0 && parts.length > 0) {
        const anyText = parts.find((p) => typeof p.text === 'string');
        if (anyText) {
          messages.push({ role: 'user', content: anyText.text ?? '' });
        }
      }
    }
  }

  return messages;
}

/**
 * Convert model parts to LLMResponseBlock[].
 */
function partsToResponseBlocks(parts: GPart[]): LLMResponseBlock[] {
  const blocks: LLMResponseBlock[] = [];

  for (const part of parts) {
    // Skip thought parts (but not functionCall parts that happen to have thoughtSignature)
    if (part.thought && !part.functionCall) continue;
    // Skip pure thought signature parts (no other content)
    if (part.thoughtSignature && !part.functionCall && !part.text) continue;

    if (part.functionCall) {
      blocks.push({
        type: 'tool_use',
        id: part.functionCall.id ?? randomUUID(),
        name: part.functionCall.name ?? '',
        input: part.functionCall.args ?? {},
      });
    } else if (typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Tools extraction
// ---------------------------------------------------------------------------

/**
 * Extract LLMToolDefinition[] from Google Tool[].
 */
export function extractTools(tools: unknown[] | undefined): LLMToolDefinition[] {
  if (!tools || tools.length === 0) return [];

  const defs: LLMToolDefinition[] = [];

  for (const tool of tools) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK tool types
    const gTool = tool as GTool;
    if (!gTool.functionDeclarations) continue;

    for (const fd of gTool.functionDeclarations) {
      // Upstream uses parametersJsonSchema; standard @google/genai uses parameters
      const params = fd.parametersJsonSchema ?? fd.parameters ?? {};
      // Ensure parameters always has type: 'object' — Anthropic requires this
      if (!params['type']) {
        params['type'] = 'object';
      }
      defs.push({
        name: fd.name ?? '',
        description: fd.description ?? '',
        parameters: params,
      });
    }
  }

  return defs;
}
