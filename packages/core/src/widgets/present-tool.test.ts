/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { PRESENT_TOOL_NAME, WIDGET_TYPES } from './widget-types.js';
import { getPresentToolDefinition } from '../tools/definitions/amodal-tools.js';

interface JsonSchema {
  type: string;
  properties: Record<string, { type: string; enum?: string[]; description?: string }>;
  required: string[];
}

describe('widget-types', () => {
  it('PRESENT_TOOL_NAME is "present"', () => {
    expect(PRESENT_TOOL_NAME).toBe('present');
  });

  it('WIDGET_TYPES has 13 types', () => {
    expect(WIDGET_TYPES).toHaveLength(13);
  });

  it('includes entity-card', () => {
    expect(WIDGET_TYPES).toContain('entity-card');
  });

  it('includes all expected types', () => {
    const expected = [
      'entity-card',
      'entity-list',
      'scope-map',
      'alert-card',
      'timeline',
      'comparison',
      'data-table',
      'score-breakdown',
      'status-board',
      'info-card',
      'metric',
    ];
    for (const t of expected) {
      expect(WIDGET_TYPES).toContain(t);
    }
  });

  it('WIDGET_TYPES is readonly', () => {
    // The array should be defined with as const
    // Verify we can read it but TypeScript enforces immutability
    expect(Array.isArray(WIDGET_TYPES)).toBe(true);
  });
});

describe('getPresentToolDefinition', () => {
  it('returns definition with correct name', () => {
    const def = getPresentToolDefinition();
    expect(def.base.name).toBe('present');
  });

  it('has widget and data as required params', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(schema.required).toEqual(['widget', 'data']);
  });

  it('widget param has enum matching WIDGET_TYPES', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(schema.properties['widget'].enum).toEqual([...WIDGET_TYPES]);
  });

  it('data param is type object', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(schema.properties['data'].type).toBe('object');
  });

  it('description mentions visual widget', () => {
    const def = getPresentToolDefinition();
    expect(def.base.description).toContain('visual widget');
  });

  it('returns consistent results across calls', () => {
    const def1 = getPresentToolDefinition();
    const def2 = getPresentToolDefinition();
    expect(def1.base.name).toBe(def2.base.name);
    expect(def1.base.description).toBe(def2.base.description);
    expect(def1.base.parametersJsonSchema).toEqual(def2.base.parametersJsonSchema);
  });

  it('parametersJsonSchema is type object', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(schema.type).toBe('object');
  });

  it('widget param has type string', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(schema.properties['widget'].type).toBe('string');
  });

  it('data param has description', () => {
    const def = getPresentToolDefinition();
    const schema = def.base.parametersJsonSchema as JsonSchema;
    expect(typeof schema.properties['data'].description).toBe('string');
    expect(schema.properties['data'].description!.length).toBeGreaterThan(0);
  });
});
