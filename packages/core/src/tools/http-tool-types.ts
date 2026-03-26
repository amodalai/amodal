/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';

/**
 * Schema for response shaping configuration.
 * Allows extracting a specific path from the response and truncating.
 */
export const ResponseShapingSchema = z.object({
  /** Dot-separated path to extract from JSON response (e.g., "data.items") */
  path: z.string().optional(),
  /** Maximum length of the response string returned to the LLM */
  maxLength: z.number().int().positive().default(50000),
});

/**
 * Schema for a single HTTP tool configuration.
 */
export const HttpToolConfigSchema = z.object({
  /** Internal tool name (used in API calls) */
  name: z.string().min(1),
  /** User-facing display name */
  displayName: z.string().min(1),
  /** Description of what the tool does (shown to the LLM) */
  description: z.string().min(1),
  /** HTTP method */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** URL template with {{connections.x}} and {{params.x}} placeholders */
  urlTemplate: z.string().min(1),
  /** Header templates (values may contain {{}} expressions) */
  headers: z.record(z.string()).optional(),
  /** Body template for POST/PUT/PATCH — string or object (values resolved) */
  bodyTemplate: z.union([z.string(), z.record(z.unknown())]).optional(),
  /** Query parameter templates (values may contain {{}} expressions) */
  queryParams: z.record(z.string()).optional(),
  /** Response shaping configuration */
  responseShaping: ResponseShapingSchema.optional(),
  /** JSON Schema describing parameters the LLM should provide */
  parameters: z.record(z.unknown()),
  /** Request timeout in milliseconds */
  timeout: z.number().int().positive().default(30000),
});

export type HttpToolConfig = z.infer<typeof HttpToolConfigSchema>;
export type ResponseShaping = z.infer<typeof ResponseShapingSchema>;
