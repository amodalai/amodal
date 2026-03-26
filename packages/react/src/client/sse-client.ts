/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { SSEEvent } from '../types';

/**
 * Parse a single SSE data line into a typed event.
 * Returns null for non-data lines or empty data.
 */
export function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith('data: ')) return null;
  const json = line.slice(6).trim();
  if (json.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE event from server
  return JSON.parse(json) as SSEEvent;
}

export interface StreamSSEOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Streams SSE events from a POST endpoint.
 * Uses fetch + ReadableStream (not EventSource, which only supports GET).
 */
export async function* streamSSE(
  url: string,
  body: Record<string, unknown>,
  options?: StreamSSEOptions,
): AsyncGenerator<SSEEvent> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`SSE request failed: ${String(response.status)} ${response.statusText}`);
  }

  yield* readSSEStream(response);
}

/**
 * Streams SSE events from a GET endpoint (e.g., task streaming).
 */
export async function* streamSSEGet(
  url: string,
  options?: StreamSSEOptions,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(url, {
    method: 'GET',
    headers: options?.headers,
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`SSE request failed: ${String(response.status)} ${response.statusText}`);
  }

  yield* readSSEStream(response);
}

/**
 * Reads SSE events from a Response body stream.
 */
async function* readSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const event = parseSSELine(trimmed);
        if (event) {
          yield event;
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim().length > 0) {
      const event = parseSSELine(buffer.trim());
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
