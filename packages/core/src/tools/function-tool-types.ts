/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import { ResponseShapingSchema } from './http-tool-types.js';
import type { ConnectionsMap } from '../templates/connections.js';

/**
 * Context passed to function tool handlers.
 */
export interface FunctionToolContext {
  /** The global fetch function for making HTTP requests */
  fetch: typeof globalThis.fetch;
  /** Connection configs (API keys, base URLs) */
  connections: ConnectionsMap;
}

/**
 * A function tool handler — custom code that executes when the tool is called.
 */
export type FunctionToolHandler = (
  params: Record<string, unknown>,
  context: FunctionToolContext,
) => Promise<unknown>;

/**
 * Map of handler names to handler functions.
 */
export type FunctionHandlerMap = Map<string, FunctionToolHandler>;

/**
 * Schema for a function tool configuration.
 */
export const FunctionToolConfigSchema = z.object({
  /** Internal tool name */
  name: z.string().min(1),
  /** User-facing display name */
  displayName: z.string().min(1),
  /** Description shown to the LLM */
  description: z.string().min(1),
  /** Handler name — must match a key in the FunctionHandlerMap */
  handler: z.string().min(1),
  /** JSON Schema describing parameters the LLM should provide */
  parameters: z.record(z.unknown()),
  /** Response shaping for the handler result */
  responseShaping: ResponseShapingSchema.optional(),
  /** Execution timeout in milliseconds */
  timeout: z.number().int().positive().default(30000),
});

export type FunctionToolConfig = z.infer<typeof FunctionToolConfigSchema>;
