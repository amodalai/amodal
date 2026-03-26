/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, afterEach} from 'vitest';
import {parseGraphQLIntrospection, fetchAndParseGraphQLSchema} from './graphql-parser.js';

const SAMPLE_INTROSPECTION = {
  data: {
    __schema: {
      queryType: {name: 'Query'},
      mutationType: {name: 'Mutation'},
      subscriptionType: null,
      types: [
        {
          name: 'Query',
          kind: 'OBJECT',
          fields: [
            {
              name: 'deals',
              description: 'Fetch deals with optional filters.',
              args: [
                {
                  name: 'status',
                  type: {kind: 'SCALAR', name: 'String'},
                },
                {
                  name: 'limit',
                  type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'Int'}},
                },
              ],
              type: {kind: 'LIST', ofType: {kind: 'OBJECT', name: 'Deal'}},
            },
            {
              name: 'deal',
              description: 'Get a single deal by ID.',
              args: [
                {
                  name: 'id',
                  type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'ID'}},
                },
              ],
              type: {kind: 'OBJECT', name: 'Deal'},
            },
          ],
        },
        {
          name: 'Mutation',
          kind: 'OBJECT',
          fields: [
            {
              name: 'updateDealStage',
              description: 'Update a deal stage.',
              args: [
                {
                  name: 'id',
                  type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'ID'}},
                },
                {
                  name: 'stage',
                  type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'String'}},
                },
              ],
              type: {kind: 'OBJECT', name: 'Deal'},
            },
          ],
        },
        {
          name: 'Deal',
          kind: 'OBJECT',
          fields: [
            {name: 'id', type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'ID'}}},
            {name: 'name', type: {kind: 'SCALAR', name: 'String'}},
          ],
        },
      ],
    },
  },
};

describe('parseGraphQLIntrospection', () => {
  it('should parse query operations', () => {
    const ops = parseGraphQLIntrospection(SAMPLE_INTROSPECTION);
    const queries = ops.filter((o) => o.operationType === 'query');
    expect(queries).toHaveLength(2);
    expect(queries[0]?.name).toBe('deals');
    expect(queries[1]?.name).toBe('deal');
  });

  it('should parse mutation operations', () => {
    const ops = parseGraphQLIntrospection(SAMPLE_INTROSPECTION);
    const mutations = ops.filter((o) => o.operationType === 'mutation');
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.name).toBe('updateDealStage');
  });

  it('should parse arguments with types', () => {
    const ops = parseGraphQLIntrospection(SAMPLE_INTROSPECTION);
    const deals = ops.find((o) => o.name === 'deals');
    expect(deals?.args).toHaveLength(2);
    expect(deals?.args[0]).toEqual({name: 'status', type: 'String', required: false});
    expect(deals?.args[1]).toEqual({name: 'limit', type: 'Int!', required: true});
  });

  it('should parse return types', () => {
    const ops = parseGraphQLIntrospection(SAMPLE_INTROSPECTION);
    const deals = ops.find((o) => o.name === 'deals');
    expect(deals?.returnType).toBe('[Deal]');

    const deal = ops.find((o) => o.name === 'deal');
    expect(deal?.returnType).toBe('Deal');
  });

  it('should include descriptions', () => {
    const ops = parseGraphQLIntrospection(SAMPLE_INTROSPECTION);
    const deals = ops.find((o) => o.name === 'deals');
    expect(deals?.description).toBe('Fetch deals with optional filters.');
  });

  it('should handle empty schema', () => {
    expect(parseGraphQLIntrospection({})).toEqual([]);
  });

  it('should handle schema without data wrapper', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [{name: 'hello', type: {kind: 'SCALAR', name: 'String'}, args: []}],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.name).toBe('hello');
  });

  it('should skip internal __fields', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [
              {name: '__type', type: {kind: 'OBJECT', name: '__Type'}, args: []},
              {name: 'users', type: {kind: 'LIST', ofType: {kind: 'OBJECT', name: 'User'}}, args: []},
            ],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.name).toBe('users');
  });

  it('should handle NON_NULL return type', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [
              {
                name: 'version',
                type: {kind: 'NON_NULL', ofType: {kind: 'SCALAR', name: 'String'}},
                args: [],
              },
            ],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops[0]?.returnType).toBe('String!');
  });

  it('should handle subscriptions', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        subscriptionType: {name: 'Subscription'},
        types: [
          {name: 'Query', kind: 'OBJECT', fields: []},
          {
            name: 'Subscription',
            kind: 'OBJECT',
            fields: [
              {name: 'onDealUpdate', type: {kind: 'OBJECT', name: 'Deal'}, args: []},
            ],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.operationType).toBe('subscription');
  });

  it('should handle missing args gracefully', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [{name: 'hello', type: {kind: 'SCALAR', name: 'String'}}],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops[0]?.args).toEqual([]);
  });

  it('should handle nested list types', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [
              {
                name: 'matrix',
                type: {
                  kind: 'LIST',
                  ofType: {kind: 'LIST', ofType: {kind: 'SCALAR', name: 'Int'}},
                },
                args: [],
              },
            ],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops[0]?.returnType).toBe('[[Int]]');
  });

  it('should handle enum types', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [
              {
                name: 'dealsByStatus',
                args: [{name: 'status', type: {kind: 'ENUM', name: 'DealStatus'}}],
                type: {kind: 'LIST', ofType: {kind: 'OBJECT', name: 'Deal'}},
              },
            ],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops[0]?.args[0]?.type).toBe('DealStatus');
  });

  it('should handle fields with no type', () => {
    const schema = {
      __schema: {
        queryType: {name: 'Query'},
        types: [
          {
            name: 'Query',
            kind: 'OBJECT',
            fields: [{name: 'unknown', args: []}],
          },
        ],
      },
    };
    const ops = parseGraphQLIntrospection(schema);
    expect(ops[0]?.returnType).toBe('Unknown');
  });
});

describe('fetchAndParseGraphQLSchema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch and parse introspection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INTROSPECTION),
    }));

    const ops = await fetchAndParseGraphQLSchema('https://api.example.com/graphql');
    expect(ops).toHaveLength(3);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/graphql',
      expect.objectContaining({method: 'POST'}),
    );
  });

  it('should throw on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 401}));

    await expect(
      fetchAndParseGraphQLSchema('https://api.example.com/graphql'),
    ).rejects.toThrow('401');
  });

  it('should pass auth headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({__schema: {types: []}}),
    }));

    await fetchAndParseGraphQLSchema(
      'https://api.example.com/graphql',
      {header: 'Authorization', value: 'Bearer token'},
    );

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers;
    expect(callHeaders['Authorization']).toBe('Bearer token');
  });
});
