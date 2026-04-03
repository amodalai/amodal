/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * MCP tool adapter (Phase 2.5).
 *
 * Converts MCP discovered tools (JSON Schema) into ToolDefinition objects
 * with Zod schemas that can be registered on our ToolRegistry. Each tool's
 * execute function delegates to the McpManager.callTool() method.
 *
 * The JSON Schema → Zod conversion handles the subset of JSON Schema that
 * MCP servers actually use for tool parameters (object schemas with typed
 * properties, optional fields, enums, arrays, nested objects).
 */

import {z} from 'zod';
import type {McpManager, McpDiscoveredTool} from '@amodalai/core';
import type {ToolDefinition, ToolContext, ToolRegistry} from './types.js';
import {ConnectionError} from '../errors.js';
import type {Logger} from '@amodalai/core';

/** Default timeout for MCP tool calls (60 seconds). */
const MCP_TOOL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// JSON Schema → Zod conversion
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema object to a Zod schema.
 *
 * Handles the subset used by MCP tool parameters:
 * - object with properties
 * - string, number, integer, boolean
 * - enum (string values)
 * - array with items
 * - nested objects
 * - required fields
 * - descriptions
 *
 * Unknown types fall back to z.unknown().
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = typeof schema['type'] === 'string' ? schema['type'] : undefined;
  const description = typeof schema['description'] === 'string' ? schema['description'] : undefined;

  let result: z.ZodTypeAny;

  // Handle enum first (can appear on any type, but most commonly strings)
  const enumValues = Array.isArray(schema['enum']) ? schema['enum'] : undefined;
  if (enumValues && enumValues.length > 0 && enumValues.every((v): v is string => typeof v === 'string')) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by length > 0 + type check
    result = z.enum(enumValues as [string, ...string[]]);
    if (description) result = result.describe(description);
    return result;
  }

  switch (type) {
    case 'object': {
      const rawProps = schema['properties'];
      const isPropsObject = rawProps !== null && typeof rawProps === 'object' && !Array.isArray(rawProps);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON Schema boundary: properties is an object of property schemas
      const properties = isPropsObject ? rawProps as Record<string, Record<string, unknown>> : undefined;
      const rawRequired = Array.isArray(schema['required']) ? schema['required'] : [];
      const required = new Set(rawRequired.filter((r): r is string => typeof r === 'string'));

      if (!properties || Object.keys(properties).length === 0) {
        result = z.record(z.unknown());
      } else {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [name, propSchema] of Object.entries(properties)) {
          let propZod = jsonSchemaToZod(propSchema);
          if (!required.has(name)) {
            propZod = propZod.optional();
          }
          shape[name] = propZod;
        }
        result = z.object(shape);
      }
      break;
    }

    case 'string':
      result = z.string();
      break;

    case 'number':
    case 'integer':
      result = z.number();
      break;

    case 'boolean':
      result = z.boolean();
      break;

    case 'array': {
      const rawItems = schema['items'];
      const isItemsObject = rawItems !== null && typeof rawItems === 'object' && !Array.isArray(rawItems);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON Schema boundary: items is a schema object
      const items = isItemsObject ? rawItems as Record<string, unknown> : undefined;
      result = z.array(items ? jsonSchemaToZod(items) : z.unknown());
      break;
    }

    case 'null':
      result = z.null();
      break;

    case undefined:
    default:
      // Unrecognized or missing type — accept anything
      result = z.unknown();
      break;
  }

  if (description) {
    result = result.describe(description);
  }

  return result;
}

// ---------------------------------------------------------------------------
// MCP tool → ToolDefinition
// ---------------------------------------------------------------------------

/**
 * Convert a single MCP discovered tool to a ToolDefinition.
 */
export function createMcpToolDefinition(
  tool: McpDiscoveredTool,
  mcpManager: McpManager,
  logger: Logger,
): ToolDefinition {
  const parametersSchema = jsonSchemaToZod(tool.parameters);

  return {
    description: tool.description,
    parameters: parametersSchema,
    readOnly: false, // MCP tools may have side effects — default conservative
    metadata: {
      category: 'mcp',
      connection: tool.serverName,
      originalName: tool.originalName,
    },

    async execute(params: unknown, ctx: ToolContext): Promise<unknown> {
      logger.debug('mcp_tool_call_start', {
        session: ctx.sessionId,
        tool: tool.name,
        server: tool.serverName,
      });

      const startTime = Date.now();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- params validated by Zod before execute; MCP tools always have object schemas
        const callPromise = mcpManager.callTool(tool.name, (params ?? {}) as Record<string, unknown>);

        // Race against timeout — McpManager.callTool doesn't accept AbortSignal
        const timeoutSignal = ctx.signal ?? AbortSignal.timeout(MCP_TOOL_TIMEOUT_MS);
        const result = await Promise.race([
          callPromise,
          new Promise<never>((_resolve, reject) => {
            if (timeoutSignal.aborted) {
              reject(new ConnectionError(
                `MCP tool call "${tool.name}" timed out`,
                {connection: tool.serverName, action: `callTool(${tool.originalName})`},
              ));
              return;
            }
            timeoutSignal.addEventListener('abort', () => {
              reject(new ConnectionError(
                `MCP tool call "${tool.name}" timed out`,
                {connection: tool.serverName, action: `callTool(${tool.originalName})`},
              ));
            }, {once: true});
          }),
        ]);

        const durationMs = Date.now() - startTime;
        logger.info('mcp_tool_call_complete', {
          session: ctx.sessionId,
          tool: tool.name,
          server: tool.serverName,
          durationMs,
          isError: result.isError ?? false,
        });

        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('\n');
          return {error: errorText || 'MCP tool returned an error'};
        }

        // Format the response content
        const output = result.content
          .map((c) => {
            if (c.type === 'text' && c.text) return c.text;
            if (c.type === 'image' && c.data) return `[image: ${c.mimeType ?? 'unknown'}]`;
            return `[${c.type}]`;
          })
          .join('\n');

        return {output};
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);

        logger.error('mcp_tool_call_failed', {
          session: ctx.sessionId,
          tool: tool.name,
          server: tool.serverName,
          durationMs,
          error: message,
        });

        // Classify the error for a helpful message
        if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('unreachable')) {
          throw new ConnectionError(
            `MCP server for "${tool.name}" is unreachable: ${message}. The MCP server may have crashed or the URL may be wrong.`,
            {connection: tool.serverName, action: `callTool(${tool.originalName})`, cause: err},
          );
        }

        if (message.includes('401') || message.includes('403') || message.includes('missing_token') || message.includes('invalid_token')) {
          throw new ConnectionError(
            `MCP authentication failed for "${tool.name}": ${message}. Check auth headers in amodal.json.`,
            {connection: tool.serverName, action: `callTool(${tool.originalName})`, cause: err},
          );
        }

        throw new ConnectionError(
          `MCP tool call failed for "${tool.name}": ${message}`,
          {connection: tool.serverName, action: `callTool(${tool.originalName})`, cause: err},
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Register all MCP tools
// ---------------------------------------------------------------------------

/**
 * Register all discovered MCP tools on a ToolRegistry.
 *
 * Call this after MCP servers have connected and discovered their tools.
 */
export function registerMcpTools(
  registry: ToolRegistry,
  mcpManager: McpManager,
  logger: Logger,
): number {
  const tools = mcpManager.getDiscoveredTools();
  let registered = 0;

  for (const tool of tools) {
    registry.register(tool.name, createMcpToolDefinition(tool, mcpManager, logger));
    registered++;
  }

  if (registered > 0) {
    logger.info('mcp_tools_registered', {count: registered, tools: tools.map((t) => t.name)});
  }

  return registered;
}
