/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {
  StoreFieldDefinitionSchema,
  StoreJsonSchema,
  StoreTtlConfigSchema,
  StoreFailureConfigSchema,
  StoreHistoryConfigSchema,
} from './store-schemas.js';

describe('StoreFieldDefinitionSchema', () => {
  it('accepts a simple string field', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'string'});
    expect(result.type).toBe('string');
  });

  it('accepts a number field with min/max', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'number', min: 0, max: 100});
    expect(result).toEqual({type: 'number', min: 0, max: 100});
  });

  it('accepts an enum field with values', () => {
    const result = StoreFieldDefinitionSchema.parse({
      type: 'enum',
      values: ['P1', 'P2', 'P3'],
    });
    expect(result.values).toEqual(['P1', 'P2', 'P3']);
  });

  it('rejects an enum field without values', () => {
    expect(() => StoreFieldDefinitionSchema.parse({type: 'enum'})).toThrow();
  });

  it('accepts an array field with item definition', () => {
    const result = StoreFieldDefinitionSchema.parse({
      type: 'array',
      item: {type: 'string'},
    });
    expect(result.type).toBe('array');
  });

  it('rejects an array field without item', () => {
    expect(() => StoreFieldDefinitionSchema.parse({type: 'array'})).toThrow();
  });

  it('accepts a nested object field', () => {
    const result = StoreFieldDefinitionSchema.parse({
      type: 'object',
      fields: {
        name: {type: 'string'},
        count: {type: 'number'},
      },
    });
    expect(result.type).toBe('object');
  });

  it('rejects an object field without fields', () => {
    expect(() => StoreFieldDefinitionSchema.parse({type: 'object'})).toThrow();
  });

  it('accepts a ref field with store target', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'ref', store: 'deals'});
    expect(result.store).toBe('deals');
  });

  it('rejects a ref field without store', () => {
    expect(() => StoreFieldDefinitionSchema.parse({type: 'ref'})).toThrow();
  });

  it('accepts nullable fields', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'string', nullable: true});
    expect(result.nullable).toBe(true);
  });

  it('accepts datetime type', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'datetime'});
    expect(result.type).toBe('datetime');
  });

  it('accepts boolean type', () => {
    const result = StoreFieldDefinitionSchema.parse({type: 'boolean'});
    expect(result.type).toBe('boolean');
  });

  it('rejects invalid type', () => {
    expect(() => StoreFieldDefinitionSchema.parse({type: 'invalid'})).toThrow();
  });
});

describe('StoreTtlConfigSchema', () => {
  it('accepts a simple number', () => {
    expect(StoreTtlConfigSchema.parse(86400)).toBe(86400);
  });

  it('accepts a conditional config', () => {
    const result = StoreTtlConfigSchema.parse({
      default: 86400,
      override: [{condition: "severity IN ['P1', 'P2']", ttl: 300}],
    });
    expect(result).toEqual({
      default: 86400,
      override: [{condition: "severity IN ['P1', 'P2']", ttl: 300}],
    });
  });

  it('rejects zero TTL', () => {
    expect(() => StoreTtlConfigSchema.parse(0)).toThrow();
  });

  it('rejects negative TTL', () => {
    expect(() => StoreTtlConfigSchema.parse(-100)).toThrow();
  });
});

describe('StoreFailureConfigSchema', () => {
  it('accepts partial mode', () => {
    const result = StoreFailureConfigSchema.parse({mode: 'partial'});
    expect(result.mode).toBe('partial');
  });

  it('accepts full config', () => {
    const result = StoreFailureConfigSchema.parse({
      mode: 'all-or-nothing',
      retries: 3,
      backoff: 'exponential',
      deadLetter: true,
    });
    expect(result).toEqual({
      mode: 'all-or-nothing',
      retries: 3,
      backoff: 'exponential',
      deadLetter: true,
    });
  });

  it('rejects invalid mode', () => {
    expect(() => StoreFailureConfigSchema.parse({mode: 'invalid'})).toThrow();
  });
});

describe('StoreHistoryConfigSchema', () => {
  it('accepts valid versions count', () => {
    expect(StoreHistoryConfigSchema.parse({versions: 5})).toEqual({versions: 5});
  });

  it('rejects zero versions', () => {
    expect(() => StoreHistoryConfigSchema.parse({versions: 0})).toThrow();
  });
});

describe('StoreJsonSchema', () => {
  const minimalStore = {
    entity: {
      name: 'DealHealth',
      key: '{dealId}',
      schema: {
        dealId: {type: 'string'},
        score: {type: 'number', min: 0, max: 100},
      },
    },
  };

  it('accepts a minimal store definition', () => {
    const result = StoreJsonSchema.parse(minimalStore);
    expect(result.entity.name).toBe('DealHealth');
  });

  it('accepts a store with explicit name', () => {
    const result = StoreJsonSchema.parse({name: 'deal-health', ...minimalStore});
    expect(result.name).toBe('deal-health');
  });

  it('rejects non-kebab-case name', () => {
    expect(() => StoreJsonSchema.parse({name: 'DealHealth', ...minimalStore})).toThrow();
  });

  it('accepts a full store definition', () => {
    const result = StoreJsonSchema.parse({
      name: 'active-alerts',
      entity: {
        name: 'ClassifiedAlert',
        key: '{event_id}',
        schema: {
          event_id: {type: 'string'},
          severity: {type: 'enum', values: ['P1', 'P2', 'P3', 'P4']},
          confidence: {type: 'number', min: 0, max: 1},
          tags: {type: 'array', item: {type: 'string'}},
          deploy: {
            type: 'object',
            nullable: true,
            fields: {
              sha: {type: 'string'},
              at: {type: 'datetime'},
            },
          },
        },
      },
      ttl: {
        default: 86400,
        override: [{condition: "severity IN ['P1', 'P2']", ttl: 300}],
      },
      failure: {mode: 'partial', retries: 2, backoff: 'exponential', deadLetter: true},
      history: {versions: 2},
      trace: true,
    });

    expect(result.name).toBe('active-alerts');
    expect(result.entity.name).toBe('ClassifiedAlert');
    expect(result.trace).toBe(true);
  });
});
