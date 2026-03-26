/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTemplate,
  resolveTemplateObject,
  type TemplateContext,
} from './template-resolver.js';

describe('resolveTemplate', () => {
  const context: TemplateContext = {
    connections: {
      device_api: {
        base_url: 'https://api.example.com',
        api_key: 'sk-secret-123',
        nested: {
          deep: {
            value: 'deep-value',
          },
        },
      },
      other_api: {
        url: 'https://other.example.com',
      },
    },
    params: {
      zone_id: 'zone-42',
      limit: 100,
      active: true,
      metadata: { key: 'val' },
    },
  };

  it('resolves a basic params variable', () => {
    const result = resolveTemplate('zone={{params.zone_id}}', context);
    expect(result.value).toBe('zone=zone-42');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves a basic connections variable', () => {
    const result = resolveTemplate(
      '{{connections.device_api.base_url}}/devices',
      context,
    );
    expect(result.value).toBe('https://api.example.com/devices');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves nested connection paths (3+ levels)', () => {
    const result = resolveTemplate(
      '{{connections.device_api.nested.deep.value}}',
      context,
    );
    expect(result.value).toBe('deep-value');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves multiple templates in one string', () => {
    const result = resolveTemplate(
      '{{connections.device_api.base_url}}/devices?zone={{params.zone_id}}',
      context,
    );
    expect(result.value).toBe(
      'https://api.example.com/devices?zone=zone-42',
    );
    expect(result.errors).toHaveLength(0);
  });

  it('returns error for missing variable', () => {
    const result = resolveTemplate('{{params.nonexistent}}', context);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].expression).toBe('params.nonexistent');
    expect(result.errors[0].message).toContain('not found');
  });

  it('returns error for invalid namespace', () => {
    const result = resolveTemplate('{{secrets.api_key}}', context);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Unknown namespace "secrets"');
  });

  it('preserves escaped templates as literal text', () => {
    const result = resolveTemplate('\\{{literal}}', context);
    expect(result.value).toBe('{{literal}}');
    expect(result.errors).toHaveLength(0);
  });

  it('handles mixed escaped and real templates', () => {
    const result = resolveTemplate(
      '\\{{literal}} and {{params.zone_id}}',
      context,
    );
    expect(result.value).toBe('{{literal}} and zone-42');
    expect(result.errors).toHaveLength(0);
  });

  it('returns input unchanged for empty string', () => {
    const result = resolveTemplate('', context);
    expect(result.value).toBe('');
    expect(result.errors).toHaveLength(0);
  });

  it('returns input unchanged for string with no templates', () => {
    const result = resolveTemplate('plain text here', context);
    expect(result.value).toBe('plain text here');
    expect(result.errors).toHaveLength(0);
  });

  it('converts number values to string', () => {
    const result = resolveTemplate('limit={{params.limit}}', context);
    expect(result.value).toBe('limit=100');
    expect(result.errors).toHaveLength(0);
  });

  it('converts boolean values to string', () => {
    const result = resolveTemplate('active={{params.active}}', context);
    expect(result.value).toBe('active=true');
    expect(result.errors).toHaveLength(0);
  });

  it('converts object values to JSON', () => {
    const result = resolveTemplate('meta={{params.metadata}}', context);
    expect(result.value).toBe('meta={"key":"val"}');
    expect(result.errors).toHaveLength(0);
  });

  it('returns error for expression without namespace separator', () => {
    const result = resolveTemplate('{{nopath}}', context);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('must be in format');
  });

  it('returns error for partial path not found', () => {
    const result = resolveTemplate(
      '{{connections.device_api.nonexistent.path}}',
      context,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].expression).toBe(
      'connections.device_api.nonexistent.path',
    );
  });

  it('handles whitespace in expressions', () => {
    const result = resolveTemplate('{{ params.zone_id }}', context);
    expect(result.value).toBe('zone-42');
    expect(result.errors).toHaveLength(0);
  });
});

describe('resolveTemplateObject', () => {
  const context: TemplateContext = {
    connections: {
      api: { url: 'https://api.test.com', key: 'secret' },
    },
    params: {
      id: '123',
    },
  };

  it('resolves all string values in a nested object', () => {
    const input = {
      url: '{{connections.api.url}}/items/{{params.id}}',
      headers: {
        Authorization: 'Bearer {{connections.api.key}}',
        'Content-Type': 'application/json',
      },
    };
    const result = resolveTemplateObject(input, context);
    expect(result.value).toEqual({
      url: 'https://api.test.com/items/123',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
    });
    expect(result.errors).toHaveLength(0);
  });

  it('passes through non-string values unchanged', () => {
    const input = { count: 5, flag: true, name: '{{params.id}}' };
    const result = resolveTemplateObject(input, context);
    expect(result.value).toEqual({ count: 5, flag: true, name: '123' });
    expect(result.errors).toHaveLength(0);
  });

  it('resolves strings inside arrays', () => {
    const input = { tags: ['{{params.id}}', 'static'] };
    const result = resolveTemplateObject(input, context);
    expect(result.value).toEqual({ tags: ['123', 'static'] });
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors from multiple fields', () => {
    const input = {
      a: '{{params.missing1}}',
      b: '{{params.missing2}}',
    };
    const result = resolveTemplateObject(input, context);
    expect(result.errors).toHaveLength(2);
  });
});
