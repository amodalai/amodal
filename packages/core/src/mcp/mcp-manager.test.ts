/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {McpManager} from './mcp-manager.js';
import type {RepoMcpServerConfig} from '../repo/repo-types.js';

const {mockStdioTransport, mockSSETransport, mockHTTPTransport} = vi.hoisted(() => ({
  mockStdioTransport: vi.fn(),
  mockSSETransport: vi.fn(),
  mockHTTPTransport: vi.fn(),
}));

// Mock the MCP SDK transports and client
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {name: 'search', description: 'Search things', inputSchema: {type: 'object', properties: {query: {type: 'string'}}}},
        {name: 'get', description: 'Get a thing', inputSchema: {type: 'object', properties: {id: {type: 'string'}}}},
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{type: 'text', text: 'result'}],
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockStdioTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mockSSETransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockHTTPTransport,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress stderr output in tests
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('McpManager', () => {
  describe('createTransport (via startServers)', () => {
    it('creates stdio transport with merged env vars', async () => {
      const manager = new McpManager();
      process.env['EXISTING_VAR'] = 'existing';

      await manager.startServers({
        test: {
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {CUSTOM_VAR: 'custom'},
        },
      });

      expect(mockStdioTransport).toHaveBeenCalledWith({
        command: 'node',
        args: ['server.js'],
        env: expect.objectContaining({
          EXISTING_VAR: 'existing',
          CUSTOM_VAR: 'custom',
        }),
      });

      delete process.env['EXISTING_VAR'];
    });

    it('creates SSE transport with url', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'sse', url: 'https://example.com/sse'},
      });

      expect(mockSSETransport).toHaveBeenCalledWith(
        new URL('https://example.com/sse'),
        undefined,
      );
    });

    it('creates SSE transport with headers when provided', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {
          transport: 'sse',
          url: 'https://example.com/sse',
          headers: {'Authorization': 'Bearer token123'},
        },
      });

      expect(mockSSETransport).toHaveBeenCalledWith(
        new URL('https://example.com/sse'),
        {requestInit: {headers: {'Authorization': 'Bearer token123'}}},
      );
    });

    it('creates HTTP transport with url', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'http', url: 'https://example.com/mcp'},
      });

      expect(mockHTTPTransport).toHaveBeenCalledWith(
        new URL('https://example.com/mcp'),
        undefined,
      );
    });

    it('creates HTTP transport with headers when provided', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {
          transport: 'http',
          url: 'https://mcp.xpoz.ai/mcp',
          headers: {'Authorization': 'Bearer my-secret-key'},
        },
      });

      expect(mockHTTPTransport).toHaveBeenCalledWith(
        new URL('https://mcp.xpoz.ai/mcp'),
        {requestInit: {headers: {'Authorization': 'Bearer my-secret-key'}}},
      );
    });

    it('errors on stdio without command', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'stdio'} as RepoMcpServerConfig,
      });

      const info = manager.getServerInfo();
      expect(info[0].status).toBe('error');
      expect(info[0].error).toContain('no command');
    });

    it('errors on http without url', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'http'} as RepoMcpServerConfig,
      });

      const info = manager.getServerInfo();
      expect(info[0].status).toBe('error');
      expect(info[0].error).toContain('no url');
    });

    it('errors on sse without url', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'sse'} as RepoMcpServerConfig,
      });

      const info = manager.getServerInfo();
      expect(info[0].status).toBe('error');
      expect(info[0].error).toContain('no url');
    });

    it('errors on unknown transport', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'websocket' as 'http'} as RepoMcpServerConfig,
      });

      const info = manager.getServerInfo();
      expect(info[0].status).toBe('error');
      expect(info[0].error).toContain('Unknown MCP transport');
    });
  });

  describe('tool discovery and namespacing', () => {
    it('discovers and namespaces tools from connected servers', async () => {
      const manager = new McpManager();

      await manager.startServers({
        myserver: {transport: 'http', url: 'https://example.com/mcp'},
      });

      const tools = manager.getDiscoveredTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('myserver__search');
      expect(tools[0].originalName).toBe('search');
      expect(tools[0].serverName).toBe('myserver');
      expect(tools[0].description).toBe('Search things');
      expect(tools[1].name).toBe('myserver__get');
    });

    it('discovers tools from multiple servers', async () => {
      const manager = new McpManager();

      await manager.startServers({
        server1: {transport: 'http', url: 'https://a.com/mcp'},
        server2: {transport: 'http', url: 'https://b.com/mcp'},
      });

      const tools = manager.getDiscoveredTools();
      expect(tools).toHaveLength(4);
      const names = tools.map(t => t.name);
      expect(names).toContain('server1__search');
      expect(names).toContain('server2__search');
    });
  });

  describe('callTool', () => {
    it('routes call to the correct server', async () => {
      const manager = new McpManager();

      await manager.startServers({
        xpoz: {transport: 'http', url: 'https://mcp.xpoz.ai/mcp'},
      });

      const result = await manager.callTool('xpoz__search', {query: 'ai agents'});
      expect(result.content).toEqual([{type: 'text', text: 'result'}]);
    });

    it('throws on invalid tool name format', async () => {
      const manager = new McpManager();

      await expect(manager.callTool('no-separator', {})).rejects.toThrow('Invalid MCP tool name');
    });

    it('throws when server is not connected', async () => {
      const manager = new McpManager();

      await expect(manager.callTool('unknown__tool', {})).rejects.toThrow('not connected');
    });
  });

  describe('isMcpTool', () => {
    it('returns true for namespaced tool names', () => {
      const manager = new McpManager();
      expect(manager.isMcpTool('xpoz__search')).toBe(true);
    });

    it('returns false for regular tool names', () => {
      const manager = new McpManager();
      expect(manager.isMcpTool('request')).toBe(false);
      expect(manager.isMcpTool('explore')).toBe(false);
    });
  });

  describe('getServerInfo', () => {
    it('returns status for all servers', async () => {
      const manager = new McpManager();

      await manager.startServers({
        working: {transport: 'http', url: 'https://a.com/mcp'},
        broken: {transport: 'http'} as RepoMcpServerConfig,
      });

      const info = manager.getServerInfo();
      expect(info).toHaveLength(2);

      const working = info.find(i => i.name === 'working')!;
      expect(working.status).toBe('connected');
      expect(working.tools).toEqual(['search', 'get']);

      const broken = info.find(i => i.name === 'broken')!;
      expect(broken.status).toBe('error');
    });
  });

  describe('shutdown', () => {
    it('disconnects all servers and clears state', async () => {
      const manager = new McpManager();

      await manager.startServers({
        test: {transport: 'http', url: 'https://example.com/mcp'},
      });

      expect(manager.connectedCount).toBe(1);

      await manager.shutdown();

      expect(manager.connectedCount).toBe(0);
      expect(manager.getDiscoveredTools()).toEqual([]);
      expect(manager.getServerInfo()).toEqual([]);
    });
  });

  describe('connectedCount', () => {
    it('counts connected servers', async () => {
      const manager = new McpManager();

      await manager.startServers({
        a: {transport: 'http', url: 'https://a.com/mcp'},
        b: {transport: 'http', url: 'https://b.com/mcp'},
        c: {transport: 'http'} as RepoMcpServerConfig, // will fail
      });

      expect(manager.connectedCount).toBe(2);
    });
  });
});
