/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';
import {ResponseShapingSchema} from '../tools/http-tool-types.js';

/** Regex for valid tool names — snake_case, starts with lowercase letter */
export const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Schema for a tool.json file in the tools/ directory.
 *
 * `name` is optional — if omitted, the directory name is used.
 * If provided, it must match the directory name.
 */
export const ToolJsonSchema = z.object({
  /** Tool name — snake_case, starts with lowercase letter. Optional; defaults to directory name. */
  name: z.string().regex(TOOL_NAME_REGEX, 'Tool name must be snake_case (lowercase letters, digits, underscores)').optional(),
  /** Description shown to the LLM */
  description: z.string().min(1),
  /** JSON Schema describing the parameters the LLM should provide */
  parameters: z.record(z.unknown()).default({}),
  /** Confirmation behavior: false=no confirm, true=confirm before run, 'review'=show params, 'never'=hide from LLM */
  confirm: z.union([z.literal(false), z.literal(true), z.literal('review'), z.literal('never')]).default(false),
  /** Execution timeout in milliseconds */
  timeout: z.number().int().positive().default(30000),
  /** Environment variable names the handler is allowed to access */
  env: z.array(z.string()).default([]),
  /** Optional response shaping configuration */
  responseShaping: ResponseShapingSchema.optional(),
  /** Sandbox configuration for hosted execution */
  sandbox: z.object({
    /** Base language runtime for the sandbox (default: 'typescript') */
    language: z.string().default('typescript'),
  }).optional(),
});

export type ToolJson = z.infer<typeof ToolJsonSchema>;

/**
 * A fully loaded custom tool ready for execution.
 */
export interface LoadedTool {
  /** Tool name (from tool.json) */
  name: string;
  /** Description (from tool.json) */
  description: string;
  /** JSON Schema parameters (from tool.json) */
  parameters: Record<string, unknown>;
  /** Confirmation behavior */
  confirm: false | true | 'review' | 'never';
  /** Execution timeout in ms */
  timeout: number;
  /** Allowed environment variable names */
  env: string[];
  /** Absolute path to handler.ts */
  handlerPath: string;
  /** Directory containing the tool */
  location: string;
  /** Whether the tool has its own package.json */
  hasPackageJson: boolean;
  /** Whether the tool has a setup.sh script */
  hasSetupScript: boolean;
  /** Whether the tool has a requirements.txt */
  hasRequirementsTxt: boolean;
  /** Whether the tool has a Dockerfile */
  hasDockerfile: boolean;
  /** Sandbox language for hosted execution (default: 'typescript') */
  sandboxLanguage: string;
  /** Optional response shaping */
  responseShaping?: z.infer<typeof ResponseShapingSchema>;
}

/**
 * Context provided to custom tool handlers at execution time.
 */
export interface CustomToolContext {
  /** Make an HTTP request through a configured connection */
  request(connection: string, endpoint: string, params?: {
    method?: string;
    data?: unknown;
    params?: Record<string, string>;
  }): Promise<unknown>;
  /** Execute a shell command (locally or in sandbox). Use to delegate to Python, Go, etc. */
  exec(command: string, options?: {cwd?: string; timeout?: number}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  /** Write a document to a store. Returns the stored key. */
  store(storeName: string, payload: Record<string, unknown>): Promise<{key: string}>;
  /** Read an environment variable (only if in the tool's env allowlist) */
  env(name: string): string | undefined;
  /** Log a message for debugging */
  log(message: string): void;
  /** Current user info */
  user: {roles: string[]; [key: string]: unknown};
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

/**
 * Definition object for a single-file tool handler.
 *
 * When a tool directory has no tool.json, the loader imports handler.ts
 * and looks for either a ToolHandlerDefinition default export (from defineToolHandler)
 * or individual named exports (description, parameters, handler, etc.).
 */
export interface ToolHandlerDefinition {
  /** Marker so the loader knows this is a defineToolHandler result */
  __toolHandler: true;
  /** Description shown to the LLM */
  description: string;
  /** JSON Schema describing parameters */
  parameters?: Record<string, unknown>;
  /** Confirmation behavior */
  confirm?: false | true | 'review' | 'never';
  /** Execution timeout in ms */
  timeout?: number;
  /** Allowed environment variable names */
  env?: string[];
  /** The handler function */
  handler: (params: Record<string, unknown>, ctx: CustomToolContext) => Promise<unknown>;
}

/**
 * Helper for defining a typed tool handler in a single file.
 *
 * Usage in handler.ts:
 * ```ts
 * import { defineToolHandler } from '@amodalai/core'
 *
 * export default defineToolHandler({
 *   description: 'Calculate weighted pipeline value',
 *   parameters: {
 *     type: 'object',
 *     properties: { deal_ids: { type: 'array', items: { type: 'string' } } },
 *     required: ['deal_ids'],
 *   },
 *   handler: async (params, ctx) => {
 *     const deals = await ctx.request('crm', '/deals')
 *     return { total: 42 }
 *   },
 * })
 * ```
 */
export function defineToolHandler(
  def: Omit<ToolHandlerDefinition, '__toolHandler'>,
): ToolHandlerDefinition {
  return {...def, __toolHandler: true};
}

/**
 * Interface for executing custom tool handlers.
 */
export interface CustomToolExecutor {
  execute(tool: LoadedTool, params: Record<string, unknown>, ctx: CustomToolContext): Promise<unknown>;
  dispose?(): void;
}

/**
 * Interface for executing shell commands.
 */
export interface CustomShellExecutor {
  exec(command: string, timeout: number, signal: AbortSignal): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  dispose?(): void;
}
