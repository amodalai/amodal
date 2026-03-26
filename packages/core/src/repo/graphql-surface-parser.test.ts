/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {parseGraphQLSurface, isGraphQLSurface} from './graphql-surface-parser.js';

const SAMPLE_SURFACE = `## Included
### QUERY deals
Fetch deals with optional filters.

### QUERY deal
Get a single deal by ID.

### MUTATION updateDealStage
Update a deal's pipeline stage.

## Excluded
### MUTATION deleteDeal
Destructive. Excluded by policy.
`;

describe('parseGraphQLSurface', () => {
  it('should parse included queries', () => {
    const endpoints = parseGraphQLSurface(SAMPLE_SURFACE);
    const queries = endpoints.filter((e) => e.method === 'QUERY' && e.included);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.path).toBe('deals');
    expect(queries[1]?.path).toBe('deal');
  });

  it('should parse included mutations', () => {
    const endpoints = parseGraphQLSurface(SAMPLE_SURFACE);
    const mutations = endpoints.filter((e) => e.method === 'MUTATION' && e.included);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.path).toBe('updateDealStage');
  });

  it('should parse excluded operations', () => {
    const endpoints = parseGraphQLSurface(SAMPLE_SURFACE);
    const excluded = endpoints.filter((e) => !e.included);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.path).toBe('deleteDeal');
    expect(excluded[0]?.method).toBe('MUTATION');
  });

  it('should preserve descriptions', () => {
    const endpoints = parseGraphQLSurface(SAMPLE_SURFACE);
    const deals = endpoints.find((e) => e.path === 'deals');
    expect(deals?.description).toBe('Fetch deals with optional filters.');
  });

  it('should handle surface without sections (all included)', () => {
    const content = `### QUERY users
List all users.

### MUTATION createUser
Create a new user.
`;
    const endpoints = parseGraphQLSurface(content);
    expect(endpoints).toHaveLength(2);
    expect(endpoints.every((e) => e.included)).toBe(true);
  });

  it('should handle subscriptions', () => {
    const content = `## Included
### SUBSCRIPTION onDealUpdate
Real-time deal updates.
`;
    const endpoints = parseGraphQLSurface(content);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.method).toBe('SUBSCRIPTION');
    expect(endpoints[0]?.path).toBe('onDealUpdate');
  });

  it('should handle empty content', () => {
    expect(parseGraphQLSurface('')).toEqual([]);
  });

  it('should handle multi-line descriptions', () => {
    const content = `### QUERY deals
Fetch deals with optional filters.
Supports pagination via limit and offset parameters.
Returns a list of Deal objects.
`;
    const endpoints = parseGraphQLSurface(content);
    expect(endpoints[0]?.description).toContain('Supports pagination');
    expect(endpoints[0]?.description).toContain('Returns a list');
  });

  it('should handle mixed REST and GraphQL headings (only parse GraphQL)', () => {
    const content = `### QUERY deals
GraphQL query.

### GET /api/deals
This is a REST heading — ignored by GraphQL parser.
`;
    const endpoints = parseGraphQLSurface(content);
    // GraphQL parser only matches QUERY/MUTATION/SUBSCRIPTION
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.method).toBe('QUERY');
  });

  it('should handle operations before any section marker', () => {
    const content = `### QUERY preSection
Before any section.

## Included
### QUERY inSection
In included section.
`;
    const endpoints = parseGraphQLSurface(content);
    expect(endpoints).toHaveLength(2);
    // Before section = scanning state = included (true)
    expect(endpoints[0]?.included).toBe(true);
    expect(endpoints[1]?.included).toBe(true);
  });
});

describe('isGraphQLSurface', () => {
  it('should detect GraphQL surface', () => {
    expect(isGraphQLSurface('### QUERY deals\nFetch deals.')).toBe(true);
    expect(isGraphQLSurface('### MUTATION create\nCreate.')).toBe(true);
    expect(isGraphQLSurface('### SUBSCRIPTION events\nStream.')).toBe(true);
  });

  it('should not detect REST surface', () => {
    expect(isGraphQLSurface('### GET /api/deals\nFetch deals.')).toBe(false);
  });

  it('should not detect empty content', () => {
    expect(isGraphQLSurface('')).toBe(false);
  });
});
