/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for Session Builder.
 *
 * Covers:
 * 1. Build from fixture bundle → all tool types registered
 * 2. Admin session → admin skills, user skills absent
 * 3. Build with MCP → MCP tools registered
 * 4. Build with pinned model → provider uses pinned model
 * 5. stop_execution tool is registered
 * 6. present tool is registered
 * 7. shell_exec is NOT registered (G24 — dropped by design)
 * 8. System prompt includes connection, skill, knowledge (G9)
 */

import {describe, it, expect, vi} from 'vitest';
import {buildSessionComponents, PRESENT_TOOL_NAME, STOP_EXECUTION_TOOL_NAME} from './session-builder.js';
import type {BuildSessionComponentsOptions} from './session-builder.js';
import type {AgentBundle, LoadedConnection, LoadedStore, LoadedTool, LoadedSkill, LoadedKnowledge} from '@amodalai/types';
import type {AdminAgentContent} from '@amodalai/core';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:session-builder'});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the provider creation to avoid real API key requirements
vi.mock('../providers/create-provider.js', () => ({
  createProvider: vi.fn((config: {provider: string; model: string}) => ({
    model: config.model,
    provider: config.provider,
    languageModel: {},
    streamText: () => { throw new Error('not implemented'); },
    generateText: () => Promise.reject(new Error('not implemented')),
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConnection(name: string): LoadedConnection {
  return {
    name,
    spec: {
      protocol: 'rest' as const,
      baseUrl: `https://api.${name}.com`,
      auth: {type: 'bearer', token: 'env:API_KEY'},
    },
    access: {
      endpoints: {
        'GET /items': {returns: ['id', 'name']},
        'POST /items': {returns: ['id'], confirm: true},
      },
    },
    surface: [
      {method: 'GET', path: '/items', description: 'List items', included: true},
      {method: 'POST', path: '/items', description: 'Create item', included: true},
    ],
    entities: 'Item — a thing',
    rules: 'Always paginate',
    location: '/tmp/connections/' + name,
  };
}

function makeStore(): LoadedStore {
  return {
    name: 'deals',
    entity: {
      name: 'Deal',
      key: '{company}_{quarter}',
      schema: {
        company: {type: 'string'},
        quarter: {type: 'string'},
        amount: {type: 'number'},
      },
    },
    location: '/tmp/stores/deals',
  };
}

function makeSkill(): LoadedSkill {
  return {
    name: 'revenue-report',
    description: 'Generate revenue report',
    trigger: 'When user asks about revenue',
    body: 'Step 1: Query charges. Step 2: Aggregate.',
    location: '/tmp/skills/revenue-report',
  };
}

function makeKnowledge(): LoadedKnowledge {
  return {
    name: 'style-guide',
    title: 'Style Guide',
    body: 'Always use markdown tables.',
    location: '/tmp/knowledge/style-guide',
  };
}

function makeCustomTool(): LoadedTool {
  return {
    name: 'analyze_data',
    description: 'Analyze data',
    parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
    confirm: true,
    timeout: 30000,
    env: ['OPENAI_API_KEY'],
    handlerPath: '/tmp/tools/analyze/handler.ts',
    location: '/tmp/tools/analyze',
    hasPackageJson: false,
    hasSetupScript: false,
    hasRequirementsTxt: false,
    hasDockerfile: false,
    sandboxLanguage: 'typescript',
  };
}

function makeBundle(overrides?: Partial<AgentBundle>): AgentBundle {
  const connections = new Map<string, LoadedConnection>();
  connections.set('stripe', makeConnection('stripe'));

  return {
    source: 'local',
    origin: '/tmp/agent',
    config: {
      name: 'test-agent',
      version: '1.0.0',
      description: 'A test agent',
      userContext: 'Be helpful and concise.',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      },
    },
    connections,
    skills: [makeSkill()],
    agents: {main: undefined, simple: undefined, subagents: []},
    automations: [],
    knowledge: [makeKnowledge()],
    evals: [],
    tools: [],
    stores: [makeStore()],
    ...overrides,
  };
}

function makeStoreBackend() {
  return {
    put: vi.fn().mockResolvedValue({version: 1}),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    history: vi.fn(),
    close: vi.fn(),
    initialize: vi.fn(),
    purgeExpired: vi.fn(),
  };
}

function makeOpts(overrides?: Partial<BuildSessionComponentsOptions>): BuildSessionComponentsOptions {
  return {
    bundle: makeBundle(),
    storeBackend: makeStoreBackend(),
    mcpManager: null,
    logger,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSessionComponents', () => {
  it('returns all required components', () => {
    const components = buildSessionComponents(makeOpts());

    expect(components.provider).toBeDefined();
    expect(components.toolRegistry).toBeDefined();
    expect(components.permissionChecker).toBeDefined();
    expect(components.systemPrompt).toBeTruthy();
    expect(components.toolContextFactory).toBeInstanceOf(Function);
    expect(components.userRoles).toEqual([]);
  });

  it('registers store tools', () => {
    const components = buildSessionComponents(makeOpts());
    const names = components.toolRegistry.names();

    expect(names).toContain('store_deals');
    expect(names).toContain('store_deals_batch');
    expect(names).toContain('query_store');
  });

  it('registers request tool when connections exist', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).toContain('request');
  });

  it('does not register request tool when no connections', () => {
    const bundle = makeBundle({connections: new Map()});
    const components = buildSessionComponents(makeOpts({bundle}));
    expect(components.toolRegistry.names()).not.toContain('request');
  });

  it('registers present tool', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).toContain(PRESENT_TOOL_NAME);
  });

  it('registers stop_execution tool', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).toContain(STOP_EXECUTION_TOOL_NAME);
  });

  it('does NOT register shell_exec (dropped by design)', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).not.toContain('shell_exec');
  });

  it('does NOT register ask_user (dropped by design)', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).not.toContain('ask_user');
  });

  it('does NOT register activate_skill (dropped by design)', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).not.toContain('activate_skill');
  });

  it('does NOT register load_knowledge (dropped by design)', () => {
    const components = buildSessionComponents(makeOpts());
    expect(components.toolRegistry.names()).not.toContain('load_knowledge');
  });

  describe('custom tools', () => {
    it('registers custom tools when executor provided', () => {
      const bundle = makeBundle({tools: [makeCustomTool()]});
      const executor = {execute: vi.fn()};
      const components = buildSessionComponents(makeOpts({bundle, toolExecutor: executor}));

      expect(components.toolRegistry.names()).toContain('analyze_data');
    });

    it('skips custom tools with confirm: never', () => {
      const tool = makeCustomTool();
      tool.confirm = 'never';
      const bundle = makeBundle({tools: [tool]});
      const executor = {execute: vi.fn()};
      const components = buildSessionComponents(makeOpts({bundle, toolExecutor: executor}));

      expect(components.toolRegistry.names()).not.toContain('analyze_data');
    });

    it('does not register custom tools without executor', () => {
      const bundle = makeBundle({tools: [makeCustomTool()]});
      const components = buildSessionComponents(makeOpts({bundle}));

      expect(components.toolRegistry.names()).not.toContain('analyze_data');
    });
  });

  describe('MCP tools', () => {
    it('registers MCP tools when mcpManager provided', () => {
      const mcpManager = {
        getDiscoveredTools: vi.fn().mockReturnValue([
          {
            name: 'mcp-server__tool1',
            description: 'A tool',
            parameters: {type: 'object', properties: {}},
            serverName: 'mcp-server',
            originalName: 'tool1',
          },
        ]),
        callTool: vi.fn(),
      };
      const components = buildSessionComponents(makeOpts({mcpManager: mcpManager as never}));

      expect(components.toolRegistry.names()).toContain('mcp-server__tool1');
    });
  });

  describe('admin sessions', () => {
    it('uses admin skills/knowledge in system prompt', () => {
      const adminContent: AdminAgentContent = {
        agentPrompt: 'You are the admin agent.',
        skills: [{name: 'manage-connections', description: 'Manage connections', body: 'Admin skill body', location: '/tmp'}],
        knowledge: [{name: 'admin-guide', title: 'Admin Guide', body: 'Admin knowledge body', location: '/tmp'}],
      };

      const components = buildSessionComponents(makeOpts({
        sessionType: 'admin',
        adminContent,
        repoRoot: '/tmp/agent',
      }));

      // Admin skills should appear in prompt
      expect(components.systemPrompt).toContain('manage-connections');
      expect(components.systemPrompt).toContain('Admin skill body');
      // User skills should NOT appear
      expect(components.systemPrompt).not.toContain('revenue-report');
    });

    it('registers admin file tools', () => {
      const adminContent: AdminAgentContent = {
        agentPrompt: null,
        skills: [],
        knowledge: [],
      };

      const components = buildSessionComponents(makeOpts({
        sessionType: 'admin',
        adminContent,
        repoRoot: '/tmp/agent',
      }));

      const names = components.toolRegistry.names();
      expect(names).toContain('read_repo_file');
      expect(names).toContain('write_repo_file');
      expect(names).toContain('delete_repo_file');
      expect(names).toContain('internal_api');
    });

    it('does not register admin file tools for chat sessions', () => {
      const components = buildSessionComponents(makeOpts());

      const names = components.toolRegistry.names();
      expect(names).not.toContain('read_repo_file');
      expect(names).not.toContain('write_repo_file');
      expect(names).not.toContain('delete_repo_file');
    });
  });

  describe('pinned model', () => {
    it('uses pinned model over bundle config', () => {
      const components = buildSessionComponents(makeOpts({
        pinnedModel: {provider: 'openai', model: 'gpt-4o'},
      }));

      expect(components.provider.model).toBe('gpt-4o');
      expect(components.provider.provider).toBe('openai');
    });
  });

  describe('system prompt (G9)', () => {
    it('includes connection endpoints', () => {
      const components = buildSessionComponents(makeOpts());
      expect(components.systemPrompt).toContain('/items');
    });

    it('includes skill body', () => {
      const components = buildSessionComponents(makeOpts());
      expect(components.systemPrompt).toContain('Query charges');
    });

    it('includes knowledge body', () => {
      const components = buildSessionComponents(makeOpts());
      expect(components.systemPrompt).toContain('markdown tables');
    });

    it('includes userContext (G10)', () => {
      const components = buildSessionComponents(makeOpts());
      expect(components.systemPrompt).toContain('Be helpful and concise');
    });
  });

  describe('stop_execution tool', () => {
    it('returns __stop sentinel', async () => {
      const components = buildSessionComponents(makeOpts());
      const tool = components.toolRegistry.get(STOP_EXECUTION_TOOL_NAME);
      expect(tool).toBeDefined();

      const result = await tool!.execute(
        {reason: 'Task complete'},
        {} as never,
      );
      expect(result).toEqual({__stop: true, reason: 'Task complete'});
    });
  });

  describe('present tool', () => {
    it('returns rendered widget data', async () => {
      const components = buildSessionComponents(makeOpts());
      const tool = components.toolRegistry.get(PRESENT_TOOL_NAME);
      expect(tool).toBeDefined();

      const result = await tool!.execute(
        {widget: 'entity-card', data: {name: 'Test'}},
        {} as never,
      );
      expect(result).toEqual({widget: 'entity-card', data: {name: 'Test'}, rendered: true});
    });
  });

  describe('tool context factory', () => {
    it('factory produces ToolContext with correct session info', () => {
      const components = buildSessionComponents(makeOpts({
        sessionId: 'sess-123',
        tenantId: 'tenant-456',
        userRoles: ['analyst'],
      }));

      const ctx = components.toolContextFactory('call-1');
      expect(ctx.sessionId).toBe('sess-123');
      expect(ctx.tenantId).toBe('tenant-456');
      expect(ctx.user.roles).toEqual(['analyst']);
    });
  });
});
