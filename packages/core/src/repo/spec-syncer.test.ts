/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {buildSyncPlan} from './spec-syncer.js';
import type {LoadedConnection} from './connection-types.js';

function makeConnection(overrides?: Partial<LoadedConnection>): LoadedConnection {
  return {
    name: 'test-api',
    spec: {
      source: 'https://api.example.com',
      format: 'openapi',
    },
    access: {
      fieldRestrictions: [],
    },
    surface: [
      {method: 'GET', path: '/users', description: 'List users', included: true},
      {method: 'POST', path: '/users', description: 'Create user', included: true},
    ],
    location: '/test/connections/test-api',
    ...overrides,
   
  } as LoadedConnection;
}

describe('buildSyncPlan', () => {
  it('should skip non-openapi connections', async () => {
    const conn = makeConnection({
      spec: {source: 'https://api.example.com', format: 'grpc'},
     
    } as Partial<LoadedConnection>);

    const plan = await buildSyncPlan(conn);
    expect(plan.added).toHaveLength(0);
    expect(plan.removed).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(2);
  });

  it('should detect drift from remote spec', async () => {
    const remoteSpec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {summary: 'List users'},
          post: {summary: 'Create user'},
        },
        '/orders': {
          get: {summary: 'List orders'}, // new endpoint
        },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(remoteSpec), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );

    const conn = makeConnection();
    const plan = await buildSyncPlan(conn);

    expect(plan.connectionName).toBe('test-api');
    expect(plan.added).toHaveLength(1);
    expect('path' in plan.added[0] && plan.added[0]['path']).toBe('/orders');
    expect(plan.unchanged.length).toBeGreaterThan(0);
  });

  it('should detect removed endpoints', async () => {
    const remoteSpec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {summary: 'List users'},
          // POST /users is missing — removed
        },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(remoteSpec), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );

    const conn = makeConnection();
    const plan = await buildSyncPlan(conn);

    expect(plan.removed).toHaveLength(1);
    expect(plan.removed[0]?.method).toBe('POST');
  });

  it('should only compare included surface endpoints', async () => {
    const conn = makeConnection({
      surface: [
        {method: 'GET', path: '/users', description: 'List', included: true},
        {method: 'GET', path: '/internal', description: 'Internal', included: false},
      ],
    });

    const remoteSpec = {
      openapi: '3.0.0',
      paths: {
        '/users': {get: {summary: 'List users'}},
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(remoteSpec), {status: 200}),
    );

    const plan = await buildSyncPlan(conn);
    // /internal should not appear as removed since it's excluded
    expect(plan.removed).toHaveLength(0);
  });

  it('should pass auth headers from connection spec', async () => {
    const conn = makeConnection({
      spec: {
        source: 'https://api.example.com',
        format: 'openapi',
        auth: {type: 'bearer', token: 'secret-token'},
      },
     
    } as Partial<LoadedConnection>);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({openapi: '3.0.0', paths: {}}), {status: 200}),
    );

    await buildSyncPlan(conn);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/openapi.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-token',
        }),
      }),
    );
  });
});
