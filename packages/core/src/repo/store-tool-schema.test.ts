/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {
  fieldToJsonSchema,
  storeToJsonSchema,
  storeToToolName,
  findStoreByToolName,
} from './store-tool-schema.js';
import type {LoadedStore, StoreFieldDefinition} from './store-types.js';

describe('fieldToJsonSchema', () => {
  it('converts string to JSON Schema', () => {
    expect(fieldToJsonSchema({type: 'string'})).toEqual({type: 'string'});
  });

  it('converts number with min/max', () => {
    expect(fieldToJsonSchema({type: 'number', min: 0, max: 100})).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 100,
    });
  });

  it('converts number without constraints', () => {
    expect(fieldToJsonSchema({type: 'number'})).toEqual({type: 'number'});
  });

  it('converts boolean', () => {
    expect(fieldToJsonSchema({type: 'boolean'})).toEqual({type: 'boolean'});
  });

  it('converts datetime to string with format', () => {
    expect(fieldToJsonSchema({type: 'datetime'})).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });

  it('converts enum to string with enum values', () => {
    expect(fieldToJsonSchema({type: 'enum', values: ['a', 'b', 'c']})).toEqual({
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
  });

  it('converts array with item type', () => {
    const field: StoreFieldDefinition = {type: 'array', item: {type: 'string'}};
    expect(fieldToJsonSchema(field)).toEqual({
      type: 'array',
      items: {type: 'string'},
    });
  });

  it('converts nested object', () => {
    const field: StoreFieldDefinition = {
      type: 'object',
      fields: {
        name: {type: 'string'},
        count: {type: 'number'},
      },
    };
    const result = fieldToJsonSchema(field);
    expect(result).toEqual({
      type: 'object',
      properties: {
        name: {type: 'string'},
        count: {type: 'number'},
      },
      required: ['name', 'count'],
    });
  });

  it('excludes nullable fields from required in nested objects', () => {
    const field: StoreFieldDefinition = {
      type: 'object',
      fields: {
        name: {type: 'string'},
        nickname: {type: 'string', nullable: true},
      },
    };
    const result = fieldToJsonSchema(field);
    expect(result['required']).toEqual(['name']);
  });

  it('converts ref to string', () => {
    expect(fieldToJsonSchema({type: 'ref', store: 'deals'})).toEqual({type: 'string'});
  });
});

describe('storeToJsonSchema', () => {
  const store: LoadedStore = {
    name: 'active-alerts',
    entity: {
      name: 'ClassifiedAlert',
      key: '{event_id}',
      schema: {
        event_id: {type: 'string'},
        severity: {type: 'enum', values: ['P1', 'P2', 'P3', 'P4']},
        confidence: {type: 'number', min: 0, max: 1},
        notes: {type: 'string', nullable: true},
      },
    },
    location: '/repo/stores/active-alerts.json',
  };

  it('produces a valid JSON Schema object', () => {
    const schema = storeToJsonSchema(store);
    expect(schema['type']).toBe('object');
    expect(schema['properties']).toBeDefined();
  });

  it('lists non-nullable fields as required', () => {
    const schema = storeToJsonSchema(store);
    const required = schema['required'];
    expect(required).toContain('event_id');
    expect(required).toContain('severity');
    expect(required).toContain('confidence');
    expect(required).not.toContain('notes');
  });

  it('wraps nullable fields with oneOf null', () => {
    const schema = storeToJsonSchema(store);
    const props = schema['properties'];
    expect(props['notes']).toEqual({
      oneOf: [{type: 'string'}, {type: 'null'}],
    });
  });

  it('maps enum fields correctly', () => {
    const schema = storeToJsonSchema(store);
    const props = schema['properties'];
    expect(props['severity']).toEqual({
      type: 'string',
      enum: ['P1', 'P2', 'P3', 'P4'],
    });
  });
});

describe('storeToToolName', () => {
  it('converts kebab-case to store_ snake_case', () => {
    expect(storeToToolName('active-alerts')).toBe('store_active_alerts');
  });

  it('handles single-word names', () => {
    expect(storeToToolName('deals')).toBe('store_deals');
  });

  it('handles multi-segment names', () => {
    expect(storeToToolName('deal-health-scores')).toBe('store_deal_health_scores');
  });
});

describe('findStoreByToolName', () => {
  const stores: LoadedStore[] = [
    {
      name: 'active-alerts',
      entity: {name: 'Alert', key: '{id}', schema: {id: {type: 'string'}}},
      location: '/repo/stores/active-alerts.json',
    },
    {
      name: 'deals',
      entity: {name: 'Deal', key: '{id}', schema: {id: {type: 'string'}}},
      location: '/repo/stores/deals.json',
    },
  ];

  it('finds a store by its tool name', () => {
    expect(findStoreByToolName(stores, 'store_active_alerts')?.name).toBe('active-alerts');
  });

  it('returns undefined for unknown tool name', () => {
    expect(findStoreByToolName(stores, 'store_unknown')).toBeUndefined();
  });

  it('finds single-word store', () => {
    expect(findStoreByToolName(stores, 'store_deals')?.name).toBe('deals');
  });
});
