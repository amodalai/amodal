/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {detectGraphQLDrift} from './graphql-drift-detector.js';
import type {ParsedGraphQLOperation} from './graphql-parser.js';
import type {SurfaceEndpoint} from './connection-types.js';

function makeOp(overrides?: Partial<ParsedGraphQLOperation>): ParsedGraphQLOperation {
  return {
    name: 'deals',
    operationType: 'query',
    args: [],
    returnType: '[Deal]',
    description: 'Fetch deals.',
    ...overrides,
  };
}

function makeSurface(overrides?: Partial<SurfaceEndpoint>): SurfaceEndpoint {
  return {
    method: 'QUERY',
    path: 'deals',
    description: 'Fetch deals.',
    included: true,
    ...overrides,
  };
}

describe('detectGraphQLDrift', () => {
  it('should detect no changes when in sync', () => {
    const result = detectGraphQLDrift(
      [makeOp()],
      [makeSurface()],
    );
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toEqual(['QUERY deals']);
  });

  it('should detect added operations', () => {
    const result = detectGraphQLDrift(
      [makeOp(), makeOp({name: 'deal', description: 'Single deal.'})],
      [makeSurface()],
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.name).toBe('deal');
  });

  it('should detect removed operations', () => {
    const result = detectGraphQLDrift(
      [makeOp()],
      [makeSurface(), makeSurface({path: 'deleteDeal', method: 'MUTATION'})],
    );
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.path).toBe('deleteDeal');
  });

  it('should detect changed descriptions', () => {
    const result = detectGraphQLDrift(
      [makeOp({description: 'Updated description.'})],
      [makeSurface({description: 'Old description.'})],
    );
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.changes).toContain('description changed');
  });

  it('should handle empty schema and surface', () => {
    const result = detectGraphQLDrift([], []);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should handle mutations', () => {
    const result = detectGraphQLDrift(
      [makeOp({name: 'createDeal', operationType: 'mutation'})],
      [makeSurface({path: 'createDeal', method: 'MUTATION'})],
    );
    expect(result.unchanged).toEqual(['MUTATION createDeal']);
  });

  it('should handle mixed operation types', () => {
    const result = detectGraphQLDrift(
      [
        makeOp({name: 'deals', operationType: 'query'}),
        makeOp({name: 'createDeal', operationType: 'mutation'}),
        makeOp({name: 'onDealUpdate', operationType: 'subscription'}),
      ],
      [
        makeSurface({path: 'deals', method: 'QUERY'}),
        makeSurface({path: 'createDeal', method: 'MUTATION'}),
      ],
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.name).toBe('onDealUpdate');
    expect(result.unchanged).toHaveLength(2);
  });

  it('should not flag change when descriptions match', () => {
    const result = detectGraphQLDrift(
      [makeOp({description: 'Same.'})],
      [makeSurface({description: 'Same.'})],
    );
    expect(result.changed).toHaveLength(0);
  });

  it('should not flag change when schema has no description', () => {
    const result = detectGraphQLDrift(
      [makeOp({description: undefined})],
      [makeSurface({description: 'Has description.'})],
    );
    expect(result.changed).toHaveLength(0);
  });

  it('should distinguish same name with different operation types', () => {
    const result = detectGraphQLDrift(
      [
        makeOp({name: 'deals', operationType: 'query'}),
        makeOp({name: 'deals', operationType: 'subscription'}),
      ],
      [makeSurface({path: 'deals', method: 'QUERY'})],
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.operationType).toBe('subscription');
    expect(result.unchanged).toEqual(['QUERY deals']);
  });
});
