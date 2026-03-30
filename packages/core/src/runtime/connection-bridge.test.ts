/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import type {LoadedConnection} from '../repo/connection-types.js';
import type {AccessConfig, ConnectionSpec} from '../repo/connection-schemas.js';
import {buildConnectionsMap, buildAccessConfigs} from './connection-bridge.js';

function makeConnection(
  name: string,
  specOverrides: Partial<ConnectionSpec> = {},
  accessOverrides: Partial<AccessConfig> = {},
): LoadedConnection {
  const spec: ConnectionSpec = {
    baseUrl: `https://${name}.example.com`,
    format: 'openapi',
    ...specOverrides,
  };
  const access: AccessConfig = {
    endpoints: {},
    ...accessOverrides,
  };
  return {
    name,
    spec,
    access,
    surface: [],
    location: `/connections/${name}`,
  };
}

describe('buildConnectionsMap', () => {
  it('builds map from single connection', () => {
    const connections = new Map([
      ['crm', makeConnection('crm')],
    ]);

    const result = buildConnectionsMap(connections);
    expect(result['crm']).toBeDefined();
    expect(result['crm']['base_url']).toBe('https://crm.example.com');
  });

  it('builds map from multiple connections', () => {
    const connections = new Map([
      ['crm', makeConnection('crm')],
      ['billing', makeConnection('billing')],
    ]);

    const result = buildConnectionsMap(connections);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['crm']['base_url']).toBe('https://crm.example.com');
    expect(result['billing']['base_url']).toBe('https://billing.example.com');
  });

  it('configures bearer auth correctly', () => {
    const connections = new Map([
      [
        'api',
        makeConnection('api', {
          auth: {type: 'bearer', token: 'my-token'},
        }),
      ],
    ]);

    const result = buildConnectionsMap(connections);
     
    const config = result['api']['_request_config'] as Record<string, unknown>;
     
    const auth = config['auth'] as Array<{header: string; value_template: string}>;
    expect(auth).toHaveLength(1);
    expect(auth[0]['header']).toBe('Authorization');
    expect(auth[0]['value_template']).toBe('Bearer my-token');
  });

  it('configures bearer auth with custom header and prefix', () => {
    const connections = new Map([
      [
        'api',
        makeConnection('api', {
          auth: {type: 'bearer', token: 'tok', header: 'X-Auth', prefix: 'Token'},
        }),
      ],
    ]);

    const result = buildConnectionsMap(connections);
     
    const config = result['api']['_request_config'] as Record<string, unknown>;
     
    const auth = config['auth'] as Array<{header: string; value_template: string}>;
    expect(auth[0]['header']).toBe('X-Auth');
    expect(auth[0]['value_template']).toBe('Token tok');
  });

  it('configures api-key auth correctly', () => {
    const connections = new Map([
      [
        'api',
        makeConnection('api', {
          auth: {type: 'api-key', token: 'sk-123'},
        }),
      ],
    ]);

    const result = buildConnectionsMap(connections);
     
    const config = result['api']['_request_config'] as Record<string, unknown>;
     
    const auth = config['auth'] as Array<{header: string; value_template: string}>;
    expect(auth).toHaveLength(1);
    expect(auth[0]['header']).toBe('X-API-Key');
    expect(auth[0]['value_template']).toBe('sk-123');
  });

  it('returns empty auth array when no auth configured', () => {
    const connections = new Map([
      ['api', makeConnection('api')],
    ]);

    const result = buildConnectionsMap(connections);
     
    const config = result['api']['_request_config'] as Record<string, unknown>;
     
    const auth = config['auth'] as unknown[];
    expect(auth).toHaveLength(0);
  });

  it('uses spec.baseUrl as base_url', () => {
    const connections = new Map([
      [
        'custom',
        makeConnection('custom', {baseUrl: 'https://my-api.internal.co/v2'}),
      ],
    ]);

    const result = buildConnectionsMap(connections);
    expect(result['custom']['base_url']).toBe('https://my-api.internal.co/v2');
  });

  it('includes correct _request_config shape', () => {
    const connections = new Map([
      ['api', makeConnection('api')],
    ]);

    const result = buildConnectionsMap(connections);
     
    const config = result['api']['_request_config'] as Record<string, unknown>;
    expect(config['base_url_field']).toBe('base_url');
    expect(config['default_headers']).toEqual({});
    expect(config['auth']).toBeDefined();
  });

  it('returns empty map for empty connections', () => {
    const result = buildConnectionsMap(new Map());
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('buildAccessConfigs', () => {
  it('extracts access configs from connections', () => {
    const access: AccessConfig = {
      endpoints: {
        'GET /customers': {returns: ['customer']},
      },
    };
    const connections = new Map([
      ['crm', makeConnection('crm', {}, access)],
    ]);

    const result = buildAccessConfigs(connections);
    expect(result.size).toBe(1);
    expect(result.get('crm')).toStrictEqual(access);
  });

  it('returns empty map for empty connections', () => {
    const result = buildAccessConfigs(new Map());
    expect(result.size).toBe(0);
  });

  it('handles multiple connections', () => {
    const connections = new Map([
      ['crm', makeConnection('crm')],
      ['billing', makeConnection('billing')],
    ]);

    const result = buildAccessConfigs(connections);
    expect(result.size).toBe(2);
    expect(result.has('crm')).toBe(true);
    expect(result.has('billing')).toBe(true);
  });
});
