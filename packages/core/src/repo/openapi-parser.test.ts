/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {parseOpenAPISpec, fetchAndParseSpec} from './openapi-parser.js';

describe('parseOpenAPISpec', () => {
  it('should return empty for null input', () => {
    expect(parseOpenAPISpec(null)).toEqual([]);
  });

  it('should return empty for non-object input', () => {
    expect(parseOpenAPISpec('string')).toEqual([]);
  });

  it('should return empty for non-3.x spec', () => {
    expect(parseOpenAPISpec({openapi: '2.0', paths: {}})).toEqual([]);
  });

  it('should return empty for spec without paths', () => {
    expect(parseOpenAPISpec({openapi: '3.0.0'})).toEqual([]);
  });

  it('should parse a simple GET endpoint', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {
            summary: 'List users',
            tags: ['users'],
          },
        },
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      method: 'GET',
      path: '/users',
      summary: 'List users',
      tags: ['users'],
      deprecated: false,
    });
  });

  it('should parse multiple methods on one path', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {summary: 'List'},
          post: {summary: 'Create'},
        },
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.method)).toContain('GET');
    expect(result.map((e) => e.method)).toContain('POST');
  });

  it('should parse parameters', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users/{id}': {
          get: {
            parameters: [
              {name: 'id', in: 'path', required: true, schema: {type: 'string'}},
              {name: 'fields', in: 'query', required: false, description: 'Fields to include'},
            ],
          },
        },
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result[0]?.parameters).toHaveLength(2);
    expect(result[0]?.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      required: true,
      type: 'string',
    });
  });

  it('should handle deprecated endpoints', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/legacy': {
          get: {deprecated: true, summary: 'Old endpoint'},
        },
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result[0]?.deprecated).toBe(true);
  });

  it('should skip non-HTTP methods', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {summary: 'List'},
          parameters: [{name: 'x'}], // path-level params, not a method
        },
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result).toHaveLength(1);
  });

  it('should parse OpenAPI 3.1.0', () => {
    const spec = {
      openapi: '3.1.0',
      paths: {
        '/items': {get: {summary: 'Get items'}},
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result).toHaveLength(1);
  });

  it('should handle empty tags', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {get: {}},
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result[0]?.tags).toEqual([]);
  });

  it('should handle multiple paths', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {get: {summary: 'Users'}},
        '/orders': {get: {summary: 'Orders'}, post: {summary: 'Create order'}},
        '/products': {get: {summary: 'Products'}},
      },
    };

    const result = parseOpenAPISpec(spec);
    expect(result).toHaveLength(4);
  });
});

describe('fetchAndParseSpec', () => {
  it('should fetch and parse JSON spec', async () => {
    const spec = {
      openapi: '3.0.0',
      paths: {'/api/test': {get: {summary: 'Test'}}},
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(spec), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );

    const result = await fetchAndParseSpec('https://api.example.com/openapi.json');
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/api/test');
  });

  it('should pass auth header when provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({openapi: '3.0.0', paths: {}}), {status: 200}),
    );

    await fetchAndParseSpec('https://api.example.com/spec', {
      header: 'X-API-Key',
      value: 'secret',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/spec',
      expect.objectContaining({
        headers: expect.objectContaining({'X-API-Key': 'secret'}),
      }),
    );
  });

  it('should throw on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', {status: 404}),
    );

    await expect(fetchAndParseSpec('https://api.example.com/spec')).rejects.toThrow('HTTP 404');
  });
});
