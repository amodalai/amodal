/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {createDispatchTool, DISPATCH_TOOL_NAME, DEFAULT_CHILD_MAX_TURNS} from './dispatch-tool.js';
import {ToolExecutionError} from '../errors.js';

describe('dispatch-tool', () => {
  it('has the correct tool name constant', () => {
    expect(DISPATCH_TOOL_NAME).toBe('dispatch_task');
  });

  it('has a sensible default child max turns', () => {
    expect(DEFAULT_CHILD_MAX_TURNS).toBe(10);
  });

  it('creates a tool definition with Zod schema', () => {
    const tool = createDispatchTool();
    expect(tool.description).toContain('child agent');
    expect(tool.readOnly).toBe(false);
    expect(tool.metadata?.category).toBe('system');
    // Zod schema should have safeParse
    expect('safeParse' in tool.parameters).toBe(true);
  });

  it('validates correct parameters', () => {
    const tool = createDispatchTool();
    const schema = tool.parameters;
    if ('safeParse' in schema) {
      const result = schema.safeParse({
        agent_name: 'data-fetcher',
        tools: ['request', 'query_store'],
        prompt: 'Fetch the latest metrics',
      });
      expect(result.success).toBe(true);
    }
  });

  it('validates parameters with optional max_turns', () => {
    const tool = createDispatchTool();
    const schema = tool.parameters;
    if ('safeParse' in schema) {
      const result = schema.safeParse({
        agent_name: 'profiler',
        tools: ['request'],
        prompt: 'Profile the entity',
        max_turns: 5,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing required fields', () => {
    const tool = createDispatchTool();
    const schema = tool.parameters;
    if ('safeParse' in schema) {
      const result = schema.safeParse({agent_name: 'test'});
      expect(result.success).toBe(false);
    }
  });

  it('rejects invalid max_turns', () => {
    const tool = createDispatchTool();
    const schema = tool.parameters;
    if ('safeParse' in schema) {
      const result = schema.safeParse({
        agent_name: 'test',
        tools: [],
        prompt: 'do thing',
        max_turns: -1,
      });
      expect(result.success).toBe(false);
    }
  });

  it('execute throws ToolExecutionError (should never be called directly)', async () => {
    const tool = createDispatchTool();
    await expect(tool.execute({}, {} as never)).rejects.toThrow(ToolExecutionError);
  });
});
