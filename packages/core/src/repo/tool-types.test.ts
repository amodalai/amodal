/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {ToolJsonSchema, defineToolHandler} from './tool-types.js';

describe('ToolJsonSchema', () => {
  const validTool = {
    description: 'Calculate weighted pipeline value',
    parameters: {
      type: 'object',
      properties: {
        deal_ids: {type: 'array', items: {type: 'string'}},
      },
      required: ['deal_ids'],
    },
  };

  it('parses a valid tool.json without name (name inferred from dir)', () => {
    const result = ToolJsonSchema.safeParse(validTool);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
      expect(result.data.confirm).toBe(false);
      expect(result.data.timeout).toBe(30000);
      expect(result.data.env).toEqual([]);
      expect(result.data.parameters).toBeDefined();
    }
  });

  it('parses a tool.json with explicit name', () => {
    const result = ToolJsonSchema.safeParse({...validTool, name: 'pipeline_value'});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('pipeline_value');
    }
  });

  it('parses a minimal tool.json (description only)', () => {
    const result = ToolJsonSchema.safeParse({description: 'A simple tool'});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parameters).toEqual({});
      expect(result.data.confirm).toBe(false);
      expect(result.data.timeout).toBe(30000);
      expect(result.data.env).toEqual([]);
    }
  });

  it('parses a fully specified tool.json', () => {
    const full = {
      ...validTool,
      name: 'my_tool',
      confirm: 'review' as const,
      timeout: 60000,
      env: ['API_KEY', 'SECRET'],
      responseShaping: {path: 'data.result', maxLength: 5000},
    };
    const result = ToolJsonSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirm).toBe('review');
      expect(result.data.timeout).toBe(60000);
      expect(result.data.env).toEqual(['API_KEY', 'SECRET']);
      expect(result.data.responseShaping?.path).toBe('data.result');
    }
  });

  it('rejects names starting with uppercase', () => {
    const result = ToolJsonSchema.safeParse({...validTool, name: 'PipelineValue'});
    expect(result.success).toBe(false);
  });

  it('rejects names starting with a digit', () => {
    const result = ToolJsonSchema.safeParse({...validTool, name: '1tool'});
    expect(result.success).toBe(false);
  });

  it('rejects names with hyphens', () => {
    const result = ToolJsonSchema.safeParse({...validTool, name: 'my-tool'});
    expect(result.success).toBe(false);
  });

  it('accepts names with underscores and digits', () => {
    const result = ToolJsonSchema.safeParse({...validTool, name: 'my_tool_2'});
    expect(result.success).toBe(true);
  });

  it('rejects empty description', () => {
    const result = ToolJsonSchema.safeParse({description: ''});
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    expect(ToolJsonSchema.safeParse({}).success).toBe(false);
    expect(ToolJsonSchema.safeParse({name: 'test'}).success).toBe(false);
  });

  it('accepts confirm: true', () => {
    const result = ToolJsonSchema.safeParse({...validTool, confirm: true});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.confirm).toBe(true);
  });

  it('accepts confirm: false', () => {
    const result = ToolJsonSchema.safeParse({...validTool, confirm: false});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.confirm).toBe(false);
  });

  it('accepts confirm: "review"', () => {
    const result = ToolJsonSchema.safeParse({...validTool, confirm: 'review'});
    expect(result.success).toBe(true);
  });

  it('accepts confirm: "never"', () => {
    const result = ToolJsonSchema.safeParse({...validTool, confirm: 'never'});
    expect(result.success).toBe(true);
  });

  it('rejects invalid confirm values', () => {
    const result = ToolJsonSchema.safeParse({...validTool, confirm: 'maybe'});
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = ToolJsonSchema.safeParse({...validTool, timeout: -1});
    expect(result.success).toBe(false);
  });

  it('rejects zero timeout', () => {
    const result = ToolJsonSchema.safeParse({...validTool, timeout: 0});
    expect(result.success).toBe(false);
  });

  it('rejects non-integer timeout', () => {
    const result = ToolJsonSchema.safeParse({...validTool, timeout: 1.5});
    expect(result.success).toBe(false);
  });
});

describe('defineToolHandler', () => {
  it('returns an object with __toolHandler marker', () => {
    const def = defineToolHandler({
      description: 'Test tool',
      handler: async () => ({ok: true}),
    });
    expect(def.__toolHandler).toBe(true);
    expect(def.description).toBe('Test tool');
    expect(typeof def.handler).toBe('function');
  });

  it('preserves all optional fields', () => {
    const def = defineToolHandler({
      description: 'Test tool',
      parameters: {type: 'object', properties: {x: {type: 'number'}}},
      confirm: 'review',
      timeout: 60000,
      env: ['MY_KEY'],
      handler: async () => ({}),
    });
    expect(def.parameters).toEqual({type: 'object', properties: {x: {type: 'number'}}});
    expect(def.confirm).toBe('review');
    expect(def.timeout).toBe(60000);
    expect(def.env).toEqual(['MY_KEY']);
  });
});

describe('AmodalConfigSchema sandbox block', () => {
  it('parses config with sandbox block', async () => {
    const {AmodalConfigSchema} = await import('./config-schema.js');
    const config = {
      name: 'test',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
      sandbox: {
        shellExec: true,
        template: 'dtn-abc123',
        maxTimeout: 60000,
      },
    };
    const result = AmodalConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sandbox?.shellExec).toBe(true);
      expect(result.data.sandbox?.template).toBe('dtn-abc123');
      expect(result.data.sandbox?.maxTimeout).toBe(60000);
    }
  });

  it('applies sandbox defaults', async () => {
    const {AmodalConfigSchema} = await import('./config-schema.js');
    const config = {
      name: 'test',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
      sandbox: {},
    };
    const result = AmodalConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sandbox?.shellExec).toBe(false);
      expect(result.data.sandbox?.maxTimeout).toBe(30000);
    }
  });

  it('parses config without sandbox block', async () => {
    const {AmodalConfigSchema} = await import('./config-schema.js');
    const config = {
      name: 'test',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    };
    const result = AmodalConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sandbox).toBeUndefined();
    }
  });
});
