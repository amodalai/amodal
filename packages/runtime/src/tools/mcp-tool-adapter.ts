/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * MCP tool adapter.
 *
 * Converts MCP discovered tools into ToolDefinition objects that can be
 * registered on our ToolRegistry. Each tool's execute function delegates
 * to the McpManager.callTool() method.
 *
 * MCP tools already have JSON Schema parameter definitions from the server.
 * We pass these through to the AI SDK via jsonSchema() — no Zod conversion
 * needed. The AI SDK sends the schema to the LLM as-is, preserving all
 * parameter descriptions, types, and constraints the server defined.
 */

import {jsonSchema} from 'ai';
import type {McpManager, McpDiscoveredTool} from '@amodalai/core';
import type {ToolDefinition, ToolContext, ToolRegistry} from './types.js';
import {ConnectionError} from '../errors.js';
import type {Logger} from '@amodalai/core';

/** Default timeout for MCP tool calls (60 seconds). */
const MCP_TOOL_TIMEOUT_MS = 60_000;

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
  // Pass the MCP server's JSON Schema directly to the AI SDK.
  // No Zod conversion — the schema goes to the LLM as-is, preserving
  // all parameter descriptions, types, and constraints.
  const parametersSchema = jsonSchema(tool.parameters);

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

        // Format the response content — preserve image blocks as structured
        // content so they can be rendered in the UI instead of being discarded.
        const hasImages = result.content.some((c) => c.type === 'image' && c.data);

        if (hasImages) {
          const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB base64
          const blocks: Array<{type: 'text'; text: string} | {type: 'image'; mimeType: string; data: string}> = [];
          for (const c of result.content) {
            if (c.type === 'text' && c.text) {
              blocks.push({type: 'text', text: c.text});
            } else if (c.type === 'image' && c.data) {
              if (c.data.length > MAX_IMAGE_SIZE) {
                const sizeMB = (c.data.length / 1024 / 1024).toFixed(1);
                blocks.push({type: 'text', text: `[image too large: ${c.mimeType ?? 'unknown'}, ${sizeMB}MB]`});
              } else {
                blocks.push({type: 'image', mimeType: c.mimeType ?? 'image/png', data: c.data});
              }
            }
          }
          return {output: blocks};
        }

        const output = result.content
          .map((c) => {
            if (c.type === 'text' && c.text) return c.text;
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
