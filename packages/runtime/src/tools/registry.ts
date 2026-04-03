/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool registry implementation.
 *
 * Holds Vercel AI SDK-compatible tool definitions for a session. Replaces
 * the upstream gemini-cli-core ToolRegistry with a simpler, type-safe
 * implementation that supports readOnly flags and metadata.
 */

import {ConfigError} from '../errors.js';
import type {ToolDefinition, ToolRegistry} from './types.js';

/**
 * Create a new ToolRegistry instance.
 *
 * @example
 * ```ts
 * const registry = createToolRegistry();
 * registry.register('query_store', {
 *   description: 'Query documents from a store',
 *   parameters: z.object({ store: z.string(), filter: z.record(z.unknown()) }),
 *   execute: async (params, ctx) => { ... },
 *   readOnly: true,
 *   metadata: { category: 'store' },
 * });
 *
 * // Pass to AI SDK
 * const result = provider.streamText({ tools: registry.getTools() });
 * ```
 */
export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  return {
    register(name: string, def: ToolDefinition): void {
      if (tools.has(name)) {
        throw new ConfigError(`Tool "${name}" is already registered. Duplicate tool names are not allowed.`, {
          key: 'tools',
          context: {toolName: name, existingCategory: tools.get(name)?.metadata?.category},
        });
      }
      tools.set(name, def);
    },

    get(name: string): ToolDefinition | undefined {
      return tools.get(name);
    },

    getTools(): Record<string, ToolDefinition> {
      const result: Record<string, ToolDefinition> = {};
      for (const [name, def] of tools) {
        result[name] = def;
      }
      return result;
    },

    names(): string[] {
      return [...tools.keys()];
    },

    subset(names: string[]): Record<string, ToolDefinition> {
      const result: Record<string, ToolDefinition> = {};
      for (const name of names) {
        const def = tools.get(name);
        if (def) {
          result[name] = def;
        }
      }
      return result;
    },

    get size(): number {
      return tools.size;
    },
  };
}
