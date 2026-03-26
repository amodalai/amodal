/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { TemplateError } from '../templates/template-resolver.js';
import type { ResponseShaping } from './http-tool-types.js';

/**
 * Make an HTTP request with abort-signal-based timeout.
 */
export async function httpFetch(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout: number;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);

  // If an external signal is provided, listen for it
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }

  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract a value at a dot-separated path from a parsed JSON object.
 */
export function extractPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment]; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
  }
  return current;
}

/**
 * Shape a response according to the responseShaping config.
 */
export function shapeResponse(
  data: unknown,
  shaping: ResponseShaping | undefined,
): string {
  let result = data;

  if (shaping?.path) {
    const extracted = extractPath(data, shaping.path);
    result = extracted !== undefined ? extracted : data;
  }

  const str = typeof result === 'string' ? result : JSON.stringify(result);
  const maxLength = shaping?.maxLength ?? 50000;

  if (str.length > maxLength) {
    return str.slice(0, maxLength) + '\n... [truncated]';
  }
  return str;
}

/**
 * Format template resolution errors into a human-readable string.
 */
export function formatTemplateErrors(errors: TemplateError[]): string {
  return errors.map((e) => `  - {{${e.expression}}}: ${e.message}`).join('\n');
}
