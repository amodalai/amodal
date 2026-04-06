/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool definition shape used by amodal tools.
 * Mirrors the upstream ToolDefinition interface.
 */
export interface ToolDefinition {
  base: {
    name: string;
    description?: string;
    parametersJsonSchema?: Record<string, unknown>;
  };
  overrides?: Record<string, {
    description?: string;
    parametersJsonSchema?: Record<string, unknown>;
  }>;
}

/**
 * Response shaping configuration for tools.
 */
export interface ResponseShaping {
  path?: string;
  maxLength?: number;
}

/**
 * A fully loaded custom tool ready for execution.
 */
export interface LoadedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  confirm: false | true | 'review' | 'never';
  timeout: number;
  env: string[];
  handlerPath: string;
  location: string;
  hasPackageJson: boolean;
  hasSetupScript: boolean;
  hasRequirementsTxt: boolean;
  hasDockerfile: boolean;
  sandboxLanguage: string;
  responseShaping?: ResponseShaping;
}

/**
 * Context provided to custom tool handlers at execution time.
 */
export interface CustomToolContext {
  request(connection: string, endpoint: string, params?: {
    method?: string;
    data?: unknown;
    params?: Record<string, string>;
  }): Promise<unknown>;
  exec(command: string, options?: {cwd?: string; timeout?: number}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  store(storeName: string, payload: Record<string, unknown>): Promise<{key: string}>;
  env(name: string): string | undefined;
  log(message: string): void;
  signal: AbortSignal;
}

/**
 * Definition object for a single-file tool handler.
 */
export interface ToolHandlerDefinition {
  __toolHandler: true;
  description: string;
  parameters?: Record<string, unknown>;
  confirm?: false | true | 'review' | 'never';
  timeout?: number;
  env?: string[];
  handler: (params: Record<string, unknown>, ctx: CustomToolContext) => Promise<unknown>;
}

/**
 * Helper for defining a typed tool handler in a single file.
 *
 * Usage in handler.ts:
 * ```ts
 * import { defineToolHandler } from '@amodalai/types'
 *
 * export default defineToolHandler({
 *   description: 'Calculate weighted pipeline value',
 *   parameters: { type: 'object', properties: { deal_ids: { type: 'array' } } },
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
