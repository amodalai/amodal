/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {z} from 'zod';
import {createToolRegistry} from './registry.js';
import {ConfigError} from '../errors.js';
import type {ToolDefinition, ToolContext} from './types.js';

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    description: 'A test tool',
    parameters: z.object({input: z.string()}),
    execute: vi.fn().mockResolvedValue({ok: true}),
    readOnly: false,
    ...overrides,
  };
}

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  user: {roles: ['admin']},
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
  tenantId: 'test-tenant',
};

describe('createToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = createToolRegistry();
    const def = makeToolDef({description: 'fetch data'});

    registry.register('fetch_data', def);

    expect(registry.get('fetch_data')).toBe(def);
  });

  it('returns undefined for unknown tools', () => {
    const registry = createToolRegistry();

    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    const registry = createToolRegistry();
    registry.register('my_tool', makeToolDef());

    expect(() => registry.register('my_tool', makeToolDef())).toThrow(ConfigError);
  });

  it('lists all tool names', () => {
    const registry = createToolRegistry();
    registry.register('tool_a', makeToolDef());
    registry.register('tool_b', makeToolDef());
    registry.register('tool_c', makeToolDef());

    expect(registry.names()).toEqual(['tool_a', 'tool_b', 'tool_c']);
  });

  it('returns all tools as a Record', () => {
    const registry = createToolRegistry();
    const defA = makeToolDef({description: 'A'});
    const defB = makeToolDef({description: 'B'});

    registry.register('tool_a', defA);
    registry.register('tool_b', defB);

    const tools = registry.getTools();
    expect(Object.keys(tools)).toEqual(['tool_a', 'tool_b']);
    expect(tools['tool_a']).toBe(defA);
    expect(tools['tool_b']).toBe(defB);
  });

  it('returns a subset of tools by name', () => {
    const registry = createToolRegistry();
    const defA = makeToolDef({description: 'A'});
    const defB = makeToolDef({description: 'B'});
    const defC = makeToolDef({description: 'C'});

    registry.register('tool_a', defA);
    registry.register('tool_b', defB);
    registry.register('tool_c', defC);

    const sub = registry.subset(['tool_a', 'tool_c']);
    expect(Object.keys(sub)).toEqual(['tool_a', 'tool_c']);
    expect(sub['tool_a']).toBe(defA);
    expect(sub['tool_c']).toBe(defC);
  });

  it('subset silently skips unknown names', () => {
    const registry = createToolRegistry();
    registry.register('tool_a', makeToolDef());

    const sub = registry.subset(['tool_a', 'nonexistent']);
    expect(Object.keys(sub)).toEqual(['tool_a']);
  });

  it('reports correct size', () => {
    const registry = createToolRegistry();
    expect(registry.size).toBe(0);

    registry.register('tool_a', makeToolDef());
    expect(registry.size).toBe(1);

    registry.register('tool_b', makeToolDef());
    expect(registry.size).toBe(2);
  });

  it('preserves readOnly flag', () => {
    const registry = createToolRegistry();
    registry.register('read_tool', makeToolDef({readOnly: true}));
    registry.register('write_tool', makeToolDef({readOnly: false}));

    expect(registry.get('read_tool')?.readOnly).toBe(true);
    expect(registry.get('write_tool')?.readOnly).toBe(false);
  });

  it('preserves metadata', () => {
    const registry = createToolRegistry();
    registry.register('store_query', makeToolDef({
      metadata: {category: 'store'},
    }));
    registry.register('api_call', makeToolDef({
      metadata: {category: 'connection', connection: 'typefully'},
    }));

    expect(registry.get('store_query')?.metadata?.category).toBe('store');
    expect(registry.get('api_call')?.metadata?.connection).toBe('typefully');
  });

  it('execute function receives params and context', async () => {
    const executeFn = vi.fn().mockResolvedValue({count: 5});
    const registry = createToolRegistry();
    registry.register('counter', makeToolDef({
      parameters: z.object({start: z.number()}),
      execute: executeFn,
    }));

    const tool = registry.get('counter')!;
    const result = await tool.execute({start: 1}, mockCtx);

    expect(executeFn).toHaveBeenCalledWith({start: 1}, mockCtx);
    expect(result).toEqual({count: 5});
  });
});
