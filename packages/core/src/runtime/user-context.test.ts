/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import type {LoadedConnection} from '../repo/connection-types.js';
import type {AccessConfig, ConnectionSpec} from '../repo/connection-schemas.js';
import {
  extractRoles,
  resolveScopeLabels,
  generateFieldGuidance,
  generateAlternativeLookupGuidance,
  defaultUserContext,
} from './user-context.js';

function makeConnection(
  name: string,
  access: Partial<AccessConfig> = {},
): LoadedConnection {
  const spec: ConnectionSpec = {
    baseUrl: `https://${name}.example.com`,
    format: 'openapi',
  };
  const fullAccess: AccessConfig = {
    endpoints: {},
    ...access,
  };
  return {
    name,
    spec,
    access: fullAccess,
    surface: [],
    location: `/connections/${name}`,
  };
}

describe('extractRoles', () => {
  it('extracts from role string', () => {
    expect(extractRoles({role: 'admin'})).toEqual(['admin']);
  });

  it('extracts from roles array', () => {
    expect(extractRoles({roles: ['a', 'b']})).toEqual(['a', 'b']);
  });

  it('extracts from permissions.role', () => {
    expect(extractRoles({permissions: {role: 'x'}})).toEqual(['x']);
  });

  it('extracts from user.role', () => {
    expect(extractRoles({user: {role: 'y'}})).toEqual(['y']);
  });

  it('returns empty array for empty object', () => {
    expect(extractRoles({})).toEqual([]);
  });

  it('filters non-string values from roles array', () => {
    expect(extractRoles({roles: ['a', 42, 'b', null]})).toEqual(['a', 'b']);
  });

  it('prefers role over roles', () => {
    expect(extractRoles({role: 'admin', roles: ['user']})).toEqual(['admin']);
  });
});

describe('resolveScopeLabels', () => {
  it('resolves scope labels for matching role', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          rowScoping: {
            customer: {
              agent: {type: 'field_match', userContextField: 'agent_id', label: 'your customers'},
            },
          },
        }),
      ],
    ]);

    const {scopeLabels, scopeRules} = resolveScopeLabels(connections, ['agent']);
    expect(scopeLabels['customer']).toBe('your customers');
    expect(scopeRules['customer']).toEqual({
      type: 'field_match',
      userContextField: 'agent_id',
      label: 'your customers',
    });
  });

  it('returns empty when no role matches', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          rowScoping: {
            customer: {
              admin: {type: 'all', label: 'all customers'},
            },
          },
        }),
      ],
    ]);

    const {scopeLabels, scopeRules} = resolveScopeLabels(connections, ['agent']);
    expect(Object.keys(scopeLabels)).toHaveLength(0);
    expect(Object.keys(scopeRules)).toHaveLength(0);
  });

  it('resolves from multiple connections', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          rowScoping: {
            customer: {
              agent: {type: 'field_match', userContextField: 'agent_id', label: 'your customers'},
            },
          },
        }),
      ],
      [
        'billing',
        makeConnection('billing', {
          rowScoping: {
            invoice: {
              agent: {type: 'through_relation', throughEntity: 'customer', label: 'your invoices'},
            },
          },
        }),
      ],
    ]);

    const {scopeLabels} = resolveScopeLabels(connections, ['agent']);
    expect(scopeLabels['customer']).toBe('your customers');
    expect(scopeLabels['invoice']).toBe('your invoices');
  });

  it('uses default label when rule has no label', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          rowScoping: {
            customer: {
              agent: {type: 'field_match', userContextField: 'agent_id'},
            },
          },
        }),
      ],
    ]);

    const {scopeLabels} = resolveScopeLabels(connections, ['agent']);
    expect(scopeLabels['customer']).toBe('scoped by field_match');
  });
});

describe('generateFieldGuidance', () => {
  it('lists never_retrieve fields', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          fieldRestrictions: [
            {entity: 'customer', field: 'ssn', policy: 'never_retrieve', sensitivity: 'pii', reason: 'PII data'},
          ],
        }),
      ],
    ]);

    const guidance = generateFieldGuidance(connections, []);
    expect(guidance).toContain('Do not request: customer.ssn (PII data)');
  });

  it('lists role_gated fields with required roles for non-matching user', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          fieldRestrictions: [
            {
              entity: 'customer',
              field: 'credit_score',
              policy: 'role_gated',
              sensitivity: 'financial',
              allowedRoles: ['manager', 'compliance'],
            },
          ],
        }),
      ],
    ]);

    const guidance = generateFieldGuidance(connections, ['agent']);
    expect(guidance).toContain('Do not request: customer.credit_score (requires role: manager, compliance)');
  });

  it('omits role_gated fields when user has matching role', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          fieldRestrictions: [
            {
              entity: 'customer',
              field: 'credit_score',
              policy: 'role_gated',
              sensitivity: 'financial',
              allowedRoles: ['manager'],
            },
          ],
        }),
      ],
    ]);

    const guidance = generateFieldGuidance(connections, ['manager']);
    expect(guidance).not.toContain('credit_score');
  });

  it('lists retrieve_but_redact fields', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          fieldRestrictions: [
            {entity: 'customer', field: 'email', policy: 'retrieve_but_redact', sensitivity: 'pii'},
          ],
        }),
      ],
    ]);

    const guidance = generateFieldGuidance(connections, []);
    expect(guidance).toContain('Will be redacted: customer.email');
  });

  it('returns empty string for no restrictions', () => {
    const connections = new Map([['crm', makeConnection('crm')]]);
    const guidance = generateFieldGuidance(connections, []);
    expect(guidance).toBe('');
  });
});

describe('generateAlternativeLookupGuidance', () => {
  it('generates guidance with lookups', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {
          alternativeLookups: [
            {
              restrictedField: 'customer.ssn',
              alternativeEndpoint: 'GET /customers/search',
              description: 'Search by name instead',
            },
          ],
        }),
      ],
    ]);

    const guidance = generateAlternativeLookupGuidance(connections);
    expect(guidance).toContain('Instead of customer.ssn, use GET /customers/search');
    expect(guidance).toContain('Search by name instead');
  });

  it('returns empty for no lookups', () => {
    const connections = new Map([['crm', makeConnection('crm')]]);
    const guidance = generateAlternativeLookupGuidance(connections);
    expect(guidance).toBe('');
  });
});

describe('defaultUserContext', () => {
  it('returns empty result', () => {
    const ctx = defaultUserContext();
    expect(ctx.raw).toEqual({});
    expect(ctx.roles).toEqual([]);
    expect(ctx.scopeLabels).toEqual({});
    expect(ctx.scopeRules).toEqual({});
    expect(ctx.fieldGuidance).toBe('');
    expect(ctx.alternativeLookupGuidance).toBe('');
  });
});
