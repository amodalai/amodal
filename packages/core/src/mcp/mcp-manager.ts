/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {Tool as McpToolSchema} from '@modelcontextprotocol/sdk/types.js';
import type {RepoMcpServerConfig} from '../repo/repo-types.js';

/**
 * A discovered tool from an MCP server.
 */
export interface McpDiscoveredTool {
  /** Namespaced tool name: serverName__toolName */
  name: string;
  /** Original tool name on the server */
  originalName: string;
  /** Server this tool belongs to */
  serverName: string;
  /** Tool description */
  description: string;
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>;
}

/**
 * Result of calling an MCP tool.
 */
export interface McpToolResult {
  content: Array<{type: string; text?: string; data?: string; mimeType?: string}>;
  isError?: boolean;
}

/**
 * Status of an MCP server connection.
 */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Info about a connected MCP server.
 */
export interface McpServerInfo {
  name: string;
  status: McpServerStatus;
  tools: string[];
  error?: string;
}

// Separator for namespaced tool names
const MCP_NAME_SEPARATOR = '__';

/**
 * Manages connections to multiple MCP servers.
 * Handles lifecycle (connect/disconnect), tool discovery, and tool execution.
 */
export class McpManager {
  private readonly clients = new Map<string, Client>();
  private readonly transports = new Map<string, Transport>();
  private readonly serverTools = new Map<string, McpToolSchema[]>();
  private readonly serverStatuses = new Map<string, McpServerStatus>();
  private readonly serverErrors = new Map<string, string>();

  /**
   * Connect to all configured MCP servers and discover their tools.
   * Non-fatal: individual server failures don't block other servers.
   */
  async startServers(configs: Record<string, RepoMcpServerConfig>): Promise<void> {
    const startPromises = Object.entries(configs).map(async ([name, config]) => {
      try {
        await this.connectServer(name, config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.serverStatuses.set(name, 'error');
        this.serverErrors.set(name, msg);
        process.stderr.write(`[MCP] Failed to connect to ${name}: ${msg}\n`);
      }
    });

    await Promise.allSettled(startPromises);
  }

  /**
   * Connect to a single MCP server.
   */
  private async connectServer(name: string, config: RepoMcpServerConfig): Promise<void> {
    this.serverStatuses.set(name, 'connecting');

    const transport = this.createTransport(name, config);
    const client = new Client({name: `amodal-${name}`, version: '1.0.0'});

    await client.connect(transport);
    this.clients.set(name, client);
    this.transports.set(name, transport);
    this.serverStatuses.set(name, 'connected');

    // Discover tools
    try {
      const toolsResult = await client.listTools();
      this.serverTools.set(name, toolsResult.tools);
      process.stderr.write(
        `[MCP] Connected to ${name}: ${toolsResult.tools.length} tools discovered\n`,
      );
    } catch {
      this.serverTools.set(name, []);
      process.stderr.write(`[MCP] Connected to ${name} but tool discovery failed\n`);
    }
  }

  /**
   * Create the appropriate transport for a server config.
   */
  private createTransport(name: string, config: RepoMcpServerConfig): Transport {
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error(`MCP server "${name}" has stdio transport but no command`);
      }
      // Merge config env vars with process.env, filtering out undefined values
      let mergedEnv: Record<string, string> | undefined;
      if (config.env) {
        mergedEnv = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) mergedEnv[k] = v;
        }
        Object.assign(mergedEnv, config.env);
      }

      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: mergedEnv,
      });
    }

    if (config.transport === 'sse') {
      if (!config.url) {
        throw new Error(`MCP server "${name}" has sse transport but no url`);
      }
      return new SSEClientTransport(new URL(config.url));
    }

    if (config.transport === 'http') {
      if (!config.url) {
        throw new Error(`MCP server "${name}" has http transport but no url`);
      }
      return new StreamableHTTPClientTransport(new URL(config.url));
    }

    throw new Error(`Unknown MCP transport "${config.transport}" for server "${name}"`);
  }

  /**
   * Get all discovered tools across all connected servers.
   */
  getDiscoveredTools(): McpDiscoveredTool[] {
    const tools: McpDiscoveredTool[] = [];

    for (const [serverName, serverTools] of this.serverTools) {
      for (const tool of serverTools) {
        tools.push({
          name: `${serverName}${MCP_NAME_SEPARATOR}${tool.name}`,
          originalName: tool.name,
          serverName,
          description: tool.description ?? `Tool from ${serverName}`,
          parameters: (tool.inputSchema ?? {type: 'object', properties: {}}) as Record<string, unknown>,
        });
      }
    }

    return tools;
  }

  /**
   * Call a tool on an MCP server.
   * @param qualifiedName — The namespaced tool name (serverName__toolName)
   * @param args — Tool arguments
   */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const sepIdx = qualifiedName.indexOf(MCP_NAME_SEPARATOR);
    if (sepIdx < 0) {
      throw new Error(`Invalid MCP tool name "${qualifiedName}" — expected serverName${MCP_NAME_SEPARATOR}toolName`);
    }

    const serverName = qualifiedName.slice(0, sepIdx);
    const toolName = qualifiedName.slice(sepIdx + MCP_NAME_SEPARATOR.length);

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const result = await client.callTool({name: toolName, arguments: args});
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- MCP result shape
    return result as unknown as McpToolResult;
  }

  /**
   * Check if a tool name is an MCP tool.
   */
  isMcpTool(name: string): boolean {
    return name.includes(MCP_NAME_SEPARATOR);
  }

  /**
   * Get status info for all servers.
   */
  getServerInfo(): McpServerInfo[] {
    const info: McpServerInfo[] = [];
    for (const [name, status] of this.serverStatuses) {
      const tools = this.serverTools.get(name) ?? [];
      info.push({
        name,
        status,
        tools: tools.map((t) => t.name),
        error: this.serverErrors.get(name),
      });
    }
    return info;
  }

  /**
   * Disconnect from all MCP servers.
   */
  async shutdown(): Promise<void> {
    const closePromises = [...this.clients.entries()].map(async ([name, client]) => {
      try {
        await client.close();
        process.stderr.write(`[MCP] Disconnected from ${name}\n`);
      } catch {
        // Best effort
      }
    });

    await Promise.allSettled(closePromises);

    this.clients.clear();
    this.transports.clear();
    this.serverTools.clear();
    this.serverStatuses.clear();
    this.serverErrors.clear();
  }

  /**
   * Number of connected servers.
   */
  get connectedCount(): number {
    let count = 0;
    for (const status of this.serverStatuses.values()) {
      if (status === 'connected') count++;
    }
    return count;
  }
}
