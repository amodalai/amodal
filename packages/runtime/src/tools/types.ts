/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool system types for the Amodal runtime.
 *
 * The ToolRegistry holds Vercel AI SDK-compatible tool definitions.
 * Each tool has a Zod schema for parameter validation, an execute
 * function, and metadata for permission/execution decisions.
 */

import type {z} from 'zod';
import type {FlexibleSchema} from 'ai';
import type {SearchProvider} from '../providers/search-provider.js';
import type {SSEAskChoiceEvent, SSEShowPreviewEvent, SSEStartOAuthEvent, SSEShowGalleryEvent, SSECollectSecretEvent} from '../types.js';

// ---------------------------------------------------------------------------
// Inline tool events (emitted via ctx.emit)
// ---------------------------------------------------------------------------

/** SSE events tools can emit inline during execution. */
export type ToolInlineEvent =
  | SSEAskChoiceEvent
  | SSEShowPreviewEvent
  | SSEStartOAuthEvent
  | SSEShowGalleryEvent
  | SSECollectSecretEvent;

// ---------------------------------------------------------------------------
// Tool context (provided to execute functions)
// ---------------------------------------------------------------------------

/**
 * Context passed to every tool execute function.
 *
 * This is the runtime's version of the context — it provides access to
 * connections, stores, logging, user info, and cancellation. Specific
 * tool categories (store tools, connection tools) may wrap this with
 * category-specific helpers.
 */
export interface ToolContext {
  /** Make an HTTP request through a configured connection */
  request(connection: string, endpoint: string, params?: {
    method?: string;
    data?: unknown;
    params?: Record<string, string>;
  }): Promise<unknown>;

  /** Write a document to a store */
  store(storeName: string, payload: Record<string, unknown>): Promise<{key: string}>;

  /** Read an environment variable (only if in the tool's env allowlist) */
  env(name: string): string | undefined;

  /** Log a message (emitted as tool_log SSE event) */
  log(message: string): void;

  /** Abort signal for cancellation/timeout */
  signal: AbortSignal;

  /** Session ID for correlation */
  sessionId: string;

  /**
   * Grounded search provider for `web_search` and `fetch_url` tools.
   * Undefined when `webTools` is not configured in amodal.json — the
   * tools return a friendly "not configured" error in that case.
   */
  searchProvider?: SearchProvider;

  /** Scope ID for per-user session isolation. Empty string means agent-level (no scope). */
  scopeId: string;

  /** Scope context key-value pairs associated with this scope */
  scopeContext?: Record<string, string>;

  /**
   * Emit an inline SSE event (e.g. `show_gallery`, `ask_choice`).
   * Drained by the executing state and pushed onto the stream
   * alongside the tool result.
   */
  emit?(event: ToolInlineEvent): void;

  /**
   * Sink populated by `emit()` and drained by the executing state.
   * @internal
   */
  inlineEvents?: ToolInlineEvent[];
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/** Tool category for permission lookup and UI grouping. */
export type ToolCategory = 'store' | 'connection' | 'custom' | 'mcp' | 'admin' | 'system';

/**
 * Metadata attached to a tool for permission, routing, and execution decisions.
 */
export interface ToolMetadata {
  /** Category for permission lookup and UI grouping */
  category: ToolCategory;
  /** Which connection this tool belongs to (for permission lookup) */
  connection?: string;
  /** Source tool name before any prefixing (for MCP tools) */
  originalName?: string;
}

/**
 * A registered tool definition.
 *
 * This is what gets passed to the AI SDK's `tools` parameter and also
 * drives our execution pipeline. The `parameters` schema is used both
 * for LLM function calling (converted to JSON Schema) and runtime
 * validation of the LLM's arguments.
 */
export interface ToolDefinition<TParams = unknown> {
  /** Description shown to the LLM */
  description: string;

  /** Schema for parameter validation — Zod schema or AI SDK jsonSchema() */
  parameters: z.ZodType<TParams> | FlexibleSchema<TParams>;

  /** Execute the tool with validated parameters */
  execute(params: TParams, ctx: ToolContext): Promise<unknown>;

  /**
   * Whether this tool only reads data (no side effects).
   *
   * Used for:
   * - Pre-execution: read-only tools can start during streaming
   * - Parallel execution: read-only tools can run concurrently
   * - Confirmation flow: write tools may require user confirmation
   */
  readOnly: boolean;

  /**
   * Whether every call to this tool must be approved by the user.
   *
   * When `true`, the agent loop routes each invocation through the
   * `CONFIRMING` state before executing. Approved calls are tracked per
   * session by `toolCallId`, so a tool does not re-prompt after approval.
   *
   * Connection tools have their own ACL-based confirmation flow via
   * `PermissionChecker` and should leave this undefined. Use this flag on
   * store, admin, or custom tools that need a generic "destructive operation"
   * gate without defining ACL rules.
   */
  requiresConfirmation?: boolean;

  /** Optional metadata for permission, routing, and UI */
  metadata?: ToolMetadata;
}

// ---------------------------------------------------------------------------
// Tool registry interface
// ---------------------------------------------------------------------------

/**
 * Registry holding all available tools for a session.
 *
 * Tools are registered at session creation time and may change across
 * sessions (different agents have different tools). The registry is
 * the single source of truth for what tools the LLM can call.
 */
export interface ToolRegistry {
  /** Register a tool. Throws if a tool with this name is already registered. */
  register(name: string, def: ToolDefinition): void;

  /** Get a tool by name. Returns undefined if not found. */
  get(name: string): ToolDefinition | undefined;

  /** Get all tools as a Record (for passing to AI SDK streamText/generateText). */
  getTools(): Record<string, ToolDefinition>;

  /** List all registered tool names. */
  names(): string[];

  /** Get a subset of tools by name (for sub-agent dispatch). */
  subset(names: string[]): Record<string, ToolDefinition>;

  /** Number of registered tools. */
  size: number;
}
