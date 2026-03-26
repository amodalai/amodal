/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import {parseSurface} from './surface-parser.js';

describe('parseSurface', () => {
  it('parses included endpoints', () => {
    const content = `# Surface: Test API

## Included Endpoints

### GET /deals
List all deals.

### GET /deals/{id}
Get a single deal with activities.

### PUT /deals/{id}
Update a deal.
Write operation — requires confirmation.
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(3);
    expect(endpoints[0]).toEqual({
      method: 'GET',
      path: '/deals',
      description: 'List all deals.',
      included: true,
    });
    expect(endpoints[1].method).toBe('GET');
    expect(endpoints[1].path).toBe('/deals/{id}');
    expect(endpoints[2].method).toBe('PUT');
    expect(endpoints[2].description).toContain('Write operation');
  });

  it('parses excluded endpoints', () => {
    const content = `# Surface

## Included Endpoints

### GET /deals
List deals.

## Excluded

### DELETE /deals/{id}
Never available to the agent.
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].included).toBe(true);
    expect(endpoints[1].method).toBe('DELETE');
    expect(endpoints[1].included).toBe(false);
  });

  it('treats all endpoints as included when no ## Included heading', () => {
    const content = `# Surface

### GET /health
Health check.

### GET /status
Status endpoint.
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].included).toBe(true);
    expect(endpoints[1].included).toBe(true);
  });

  it('handles empty content', () => {
    expect(parseSurface('')).toEqual([]);
  });

  it('handles content with no endpoints', () => {
    const content = `# Surface: Test

Some description text.

## Notes

Nothing here.
`;
    expect(parseSurface(content)).toEqual([]);
  });

  it('supports all HTTP methods', () => {
    const content = `## Included Endpoints

### GET /a
get
### POST /b
post
### PUT /c
put
### PATCH /d
patch
### DELETE /e
delete
### HEAD /f
head
### OPTIONS /g
options
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(7);
    expect(endpoints.map((e) => e.method)).toEqual([
      'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    ]);
  });

  it('captures multi-line descriptions', () => {
    const content = `## Included Endpoints

### GET /deals/summary
Aggregated deal stats — count by stage, total pipeline value.
Prefer over: GET /deals when answering aggregate questions.
Use this for "how's the pipeline" type queries.
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].description).toContain('Prefer over');
    expect(endpoints[0].description).toContain('pipeline');
  });

  it('handles endpoints with path parameters', () => {
    const content = `## Included Endpoints

### GET /users/{id}/context
User context endpoint.

### POST /deals/{id}/activities
Create activity on a deal.
`;

    const endpoints = parseSurface(content);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].path).toBe('/users/{id}/context');
    expect(endpoints[1].path).toBe('/deals/{id}/activities');
  });
});
