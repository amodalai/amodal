/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  SSEAskChoiceEvent,
  SSEShowPreviewEvent,
  SSEStartOAuthEvent,
} from './sse-types.js';
import type {FsBackend} from './fs.js';

/**
 * Inline SSE events a custom tool handler may emit through `ctx.emit`.
 *
 * Kept narrow on purpose — only events the chat widget renders inline
 * are reachable from a tool. Tool-call events, errors, and stream-level
 * events are emitted by the runtime, not by handlers.
 */
export type CustomToolInlineEvent =
  | SSEAskChoiceEvent
  | SSEShowPreviewEvent
  | SSEStartOAuthEvent;

/**
 * Tool definition shape used by amodal tools.
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
 *
 * The base surface (`request`, `exec`, `store`, `env`, `log`, `signal`)
 * is the legacy one custom tools have always received. The optional
 * fields below are populated by the runtime adapter for handlers that
 * opt into the richer SDK shape — they let a handler emit inline UI
 * (`emit`), read repo files through the sandboxed backend (`fs`), and
 * scope work to the active agent / scope / session (`agentId`,
 * `scopeId`, `sessionId`). Older handlers that don't reach for them
 * keep working unchanged.
 *
 * Phase 0 added `emit?`. Phase A adds `fs?` and the identity fields so
 * the validate_connection tool can read a connection package's
 * `validate.ts` through the sandbox. Subsequent phases will extend
 * with `db?` and `fetch?` when their consumers land.
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
  /**
   * Emit an inline SSE event the chat widget renders alongside the
   * agent's prose. Used by handlers that produce inline UI (e.g.
   * `show_preview` cards). Optional — most tools never call it.
   */
  emit?(event: CustomToolInlineEvent): void;
  /**
   * Repo file access, sandboxed to the agent's repo root. Absolute
   * paths and `..` traversal are rejected. Used by handlers that read
   * config or per-package metadata (e.g. `validate_connection` reading
   * a connection package's probe file).
   */
  fs?: FsBackend;
  /** Stable id of the agent the tool is running on behalf of. */
  agentId?: string;
  /** Per-user scope key. Empty string = agent-level (no scope). */
  scopeId?: string;
  /** Session id for log correlation and ask-id derivation. */
  sessionId?: string;
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
