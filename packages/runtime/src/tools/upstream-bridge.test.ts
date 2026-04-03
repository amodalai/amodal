/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {z} from 'zod';
import {bridgeToUpstream, registerOnUpstream} from './upstream-bridge.js';
import type {ToolDefinition, ToolContext} from './types.js';

function makeMockContext(): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    user: {roles: []},
    signal: AbortSignal.timeout(10000),
    sessionId: 'test-session',
    tenantId: 'test-tenant',
  };
}

function makeToolDef(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    description: 'Test tool',
    parameters: z.object({input: z.string()}),
    readOnly: false,
    execute: vi.fn().mockResolvedValue({result: 'ok'}),
    ...overrides,
  };
}

describe('bridgeToUpstream', () => {
  it('returns an object with the upstream DeclarativeTool shape', () => {
    const def = makeToolDef();
    const bridged = bridgeToUpstream('my_tool', def, {type: 'object'}, makeMockContext) as Record<string, unknown>;

    expect(bridged['name']).toBe('my_tool');
    expect(bridged['displayName']).toBe('my_tool');
    expect(bridged['description']).toBe('Test tool');
    expect(bridged['kind']).toBe('declarative');
    expect(bridged['parameterSchema']).toEqual({type: 'object'});
    expect(bridged['isReadOnly']).toBe(false);
    expect(typeof bridged['getSchema']).toBe('function');
    expect(typeof bridged['build']).toBe('function');
    expect(typeof bridged['silentBuild']).toBe('function');
    expect(typeof bridged['validateBuildAndExecute']).toBe('function');
  });

  it('getSchema returns name, description, and parametersJsonSchema', () => {
    const def = makeToolDef({description: 'Search repos'});
    const schema = {type: 'object', properties: {q: {type: 'string'}}};
    const bridged = bridgeToUpstream('search', def, schema, makeMockContext) as {getSchema(): Record<string, unknown>};

    expect(bridged.getSchema()).toEqual({
      name: 'search',
      description: 'Search repos',
      parametersJsonSchema: schema,
    });
  });

  it('build().execute() calls the ToolDefinition execute and formats result', async () => {
    const execute = vi.fn().mockResolvedValue({items: [1, 2, 3]});
    const def = makeToolDef({execute});
    const bridged = bridgeToUpstream('tool', def, {type: 'object'}, makeMockContext) as {
      build(params: Record<string, unknown>): {execute(): Promise<{llmContent: string}>};
    };

    const invocation = bridged.build({input: 'test'});
    const result = await invocation.execute();

    expect(execute).toHaveBeenCalledWith({input: 'test'}, expect.anything());
    expect(result.llmContent).toBe('{"items":[1,2,3]}');
  });

  it('formats errors as structured error result (not thrown)', async () => {
    const def = makeToolDef({
      execute: vi.fn().mockRejectedValue(new Error('Tool crashed')),
    });
    const bridged = bridgeToUpstream('broken', def, {type: 'object'}, makeMockContext) as {
      validateBuildAndExecute(params: Record<string, unknown>): Promise<{llmContent: string; error?: {message: string}}>;
    };

    const result = await bridged.validateBuildAndExecute({});

    expect(result.llmContent).toBe('Error: Tool crashed');
    expect(result.error).toEqual({message: 'Tool crashed', type: 'EXECUTION_FAILED'});
  });

  it('respects readOnly flag', () => {
    const def = makeToolDef({readOnly: true});
    const bridged = bridgeToUpstream('reader', def, {type: 'object'}, makeMockContext) as {isReadOnly: boolean};

    expect(bridged.isReadOnly).toBe(true);
  });
});

describe('registerOnUpstream', () => {
  it('calls registerTool on the upstream registry', () => {
    const registerTool = vi.fn();
    const registry = {registerTool};
    const bridged = {name: 'test'};

    registerOnUpstream(registry, bridged);

    expect(registerTool).toHaveBeenCalledWith(bridged);
  });
});
