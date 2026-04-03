/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool system types for the Amodal runtime.
 *
 * Replaces the upstream gemini-cli-core ToolRegistry with our own that
 * holds Vercel AI SDK-compatible tool definitions. Each tool has a Zod
 * schema for parameter validation, an execute function, and metadata
 * for permission/execution decisions.
 */

import type {z} from 'zod';

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

  /** Current user info */
  user: {roles: string[]; [key: string]: unknown};

  /** Abort signal for cancellation/timeout */
  signal: AbortSignal;

  /** Session ID for correlation */
  sessionId: string;
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

  /** Zod schema for parameter validation (converted to JSON Schema for the LLM) */
  parameters: z.ZodType<TParams>;

  /** Execute the tool with validated parameters */
  execute(params: TParams, ctx: ToolContext): Promise<unknown>;

  /**
   * Whether this tool only reads data (no side effects).
   *
   * Used for:
   * - Pre-execution: read-only tools can start during streaming (Phase 3)
   * - Parallel execution: read-only tools can run concurrently (Roadmap 2.5)
   * - Confirmation flow: write tools may require user confirmation
   */
  readOnly: boolean;

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
