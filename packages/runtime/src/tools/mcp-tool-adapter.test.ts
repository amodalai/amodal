/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * MCP Tool Adapter Tests
 *
 * Tests the conversion of MCP discovered tools to ToolDefinition objects:
 * 1. Tool creation with JSON Schema passthrough
 * 2. Tool execution via McpManager.callTool()
 * 3. Registration on ToolRegistry
 * 4. Error classification (connection, auth, generic)
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {McpManager, McpDiscoveredTool} from '@amodalai/core';
import {createMcpToolDefinition, registerMcpTools} from './mcp-tool-adapter.js';
import {createToolRegistry} from './registry.js';
import {ConnectionError} from '../errors.js';
import type {ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeMockContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    signal: AbortSignal.timeout(10000),
    sessionId: 'test-session',
    ...overrides,
  };
}

function makeMockMcpManager(overrides?: {
  getDiscoveredTools?: () => McpDiscoveredTool[];
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}): McpManager {
  return {
    getDiscoveredTools: overrides?.getDiscoveredTools ?? (() => []),
    callTool: overrides?.callTool ?? vi.fn().mockResolvedValue({
      content: [{type: 'text', text: 'mock result'}],
    }),
    isMcpTool: vi.fn(),
    startServers: vi.fn(),
    getServerInfo: vi.fn(),
    shutdown: vi.fn(),
  } as unknown as McpManager;
}

// ---------------------------------------------------------------------------
// 1. Tool creation with JSON Schema passthrough
// ---------------------------------------------------------------------------

describe('createMcpToolDefinition', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it('creates a ToolDefinition with correct metadata', () => {
    const tool: McpDiscoveredTool = {
      name: 'github__search_repos',
      originalName: 'search_repos',
      serverName: 'github',
      description: 'Search GitHub repositories',
      parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
    };

    const mcpManager = makeMockMcpManager();
    const def = createMcpToolDefinition(tool, mcpManager, logger);

    expect(def.description).toBe('Search GitHub repositories');
    expect(def.readOnly).toBe(false);
    expect(def.metadata).toEqual({
      category: 'mcp',
      connection: 'github',
      originalName: 'search_repos',
    });
    // Parameters should be defined (jsonSchema passthrough)
    expect(def.parameters).toBeDefined();
  });

  it('execute calls mcpManager.callTool with correct args', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{type: 'text', text: '{"repos": [{"name": "amodal"}]}'}],
    });

    const mcpManager = makeMockMcpManager({callTool});

    const tool: McpDiscoveredTool = {
      name: 'github__search',
      originalName: 'search',
      serverName: 'github',
      description: 'Search',
      parameters: {type: 'object', properties: {q: {type: 'string'}}},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    const ctx = makeMockContext();
    const result = await def.execute({q: 'test'}, ctx);

    expect(callTool).toHaveBeenCalledWith('github__search', {q: 'test'});
    expect(result).toEqual({output: '{"repos": [{"name": "amodal"}]}'});

    // Verify structured logging
    expect(logger.debug).toHaveBeenCalledWith('mcp_tool_call_start', expect.objectContaining({
      tool: 'github__search',
      server: 'github',
    }));
    expect(logger.info).toHaveBeenCalledWith('mcp_tool_call_complete', expect.objectContaining({
      tool: 'github__search',
      isError: false,
      durationMs: expect.any(Number),
    }));
  });

  it('returns error object when MCP tool signals an error', async () => {
    const mcpManager = makeMockMcpManager({
      callTool: vi.fn().mockResolvedValue({
        content: [{type: 'text', text: 'Permission denied'}],
        isError: true,
      }),
    });

    const tool: McpDiscoveredTool = {
      name: 'server__action',
      originalName: 'action',
      serverName: 'server',
      description: 'Do action',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    const result = await def.execute({}, makeMockContext());

    expect(result).toEqual({error: 'Permission denied'});
    expect(logger.info).toHaveBeenCalledWith('mcp_tool_call_complete', expect.objectContaining({
      isError: true,
    }));
  });

  it('throws ConnectionError on ECONNREFUSED', async () => {
    const mcpManager = makeMockMcpManager({
      callTool: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3000')),
    });

    const tool: McpDiscoveredTool = {
      name: 'broken__tool',
      originalName: 'tool',
      serverName: 'broken',
      description: 'Broken',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    await expect(def.execute({}, makeMockContext())).rejects.toThrow(ConnectionError);
    await expect(def.execute({}, makeMockContext())).rejects.toThrow(/unreachable/);

    expect(logger.error).toHaveBeenCalledWith('mcp_tool_call_failed', expect.objectContaining({
      tool: 'broken__tool',
    }));
  });

  it('throws ConnectionError on auth failure', async () => {
    const mcpManager = makeMockMcpManager({
      callTool: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    });

    const tool: McpDiscoveredTool = {
      name: 'secure__tool',
      originalName: 'tool',
      serverName: 'secure',
      description: 'Secure',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    await expect(def.execute({}, makeMockContext())).rejects.toThrow(ConnectionError);
    await expect(def.execute({}, makeMockContext())).rejects.toThrow(/authentication failed/i);
  });

  it('throws ConnectionError when ctx.signal is already aborted (timeout)', async () => {
    const mcpManager = makeMockMcpManager({
      callTool: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    });

    const tool: McpDiscoveredTool = {
      name: 'slow__tool',
      originalName: 'tool',
      serverName: 'slow',
      description: 'Slow',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);

    const abortController = new AbortController();
    abortController.abort();
    const ctx = makeMockContext({signal: abortController.signal});

    await expect(def.execute({}, ctx)).rejects.toThrow(ConnectionError);
    await expect(def.execute({}, ctx)).rejects.toThrow(/timed out/);
  });

  it('preserves image content blocks as structured output', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {type: 'text', text: 'Here is the screenshot'},
        {type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg=='},
      ],
    });

    const mcpManager = makeMockMcpManager({callTool});
    const tool: McpDiscoveredTool = {
      name: 'browser__screenshot',
      originalName: 'screenshot',
      serverName: 'browser',
      description: 'Take screenshot',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    const result = await def.execute({}, makeMockContext());

    // Should return structured content blocks, not a placeholder string
    expect(result).toEqual({
      output: [
        {type: 'text', text: 'Here is the screenshot'},
        {type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg=='},
      ],
    });
  });

  it('replaces oversized images with text placeholder', async () => {
    const largeData = 'x'.repeat(6 * 1024 * 1024); // 6MB — exceeds 5MB limit
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {type: 'text', text: 'result'},
        {type: 'image', mimeType: 'image/png', data: largeData},
      ],
    });

    const mcpManager = makeMockMcpManager({callTool});
    const tool: McpDiscoveredTool = {
      name: 'browser__screenshot',
      originalName: 'screenshot',
      serverName: 'browser',
      description: 'Take screenshot',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    const result = await def.execute({}, makeMockContext());

     
    const blocks = (result as {output: Array<{type: string; text?: string}>}).output;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({type: 'text', text: 'result'});
    expect(blocks[1].type).toBe('text');
    expect(blocks[1].text).toContain('image too large');
  });

  it('returns plain string output when no images are present', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {type: 'text', text: 'just text'},
        {type: 'text', text: 'more text'},
      ],
    });

    const mcpManager = makeMockMcpManager({callTool});
    const tool: McpDiscoveredTool = {
      name: 'server__tool',
      originalName: 'tool',
      serverName: 'server',
      description: 'Do thing',
      parameters: {type: 'object'},
    };

    const def = createMcpToolDefinition(tool, mcpManager, logger);
    const result = await def.execute({}, makeMockContext());

    // No images — should return plain string, not blocks
    expect(result).toEqual({output: 'just text\nmore text'});
  });
});

// ---------------------------------------------------------------------------
// 3. Registration on ToolRegistry
// ---------------------------------------------------------------------------

describe('registerMcpTools', () => {
  it('registers all discovered tools on the registry', () => {
    const logger = makeMockLogger();
    const mcpManager = makeMockMcpManager({
      getDiscoveredTools: () => [
        {name: 'github__search', originalName: 'search', serverName: 'github', description: 'Search repos', parameters: {type: 'object', properties: {q: {type: 'string'}}}},
        {name: 'github__get_repo', originalName: 'get_repo', serverName: 'github', description: 'Get repo', parameters: {type: 'object', properties: {owner: {type: 'string'}, repo: {type: 'string'}}}},
        {name: 'slack__send', originalName: 'send', serverName: 'slack', description: 'Send message', parameters: {type: 'object', properties: {channel: {type: 'string'}, text: {type: 'string'}}}},
      ],
    });

    const registry = createToolRegistry();
    const count = registerMcpTools(registry, mcpManager, logger);

    expect(count).toBe(3);
    expect(registry.names()).toContain('github__search');
    expect(registry.names()).toContain('github__get_repo');
    expect(registry.names()).toContain('slack__send');
    expect(registry.size).toBe(3);

    // Each tool should have correct metadata
    const searchTool = registry.get('github__search');
    expect(searchTool).toBeDefined();
    expect(searchTool!.metadata?.category).toBe('mcp');
    expect(searchTool!.metadata?.connection).toBe('github');

    // Log event
    expect(logger.info).toHaveBeenCalledWith('mcp_tools_registered', expect.objectContaining({
      count: 3,
    }));
  });

  it('returns 0 and does not log when no tools discovered', () => {
    const logger = makeMockLogger();
    const mcpManager = makeMockMcpManager({getDiscoveredTools: () => []});
    const registry = createToolRegistry();

    const count = registerMcpTools(registry, mcpManager, logger);

    expect(count).toBe(0);
    expect(registry.size).toBe(0);
    expect(logger.info).not.toHaveBeenCalledWith('mcp_tools_registered', expect.anything());
  });
});
