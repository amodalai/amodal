/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import {
  ConnectionSpecSchema,
  AccessConfigSchema,
  EndpointAccessSchema,
  FieldRestrictionSchema,
  ScopingRuleSchema,
  ThresholdSchema,
  AlternativeLookupSchema,
} from './connection-schemas.js';

describe('ConnectionSpecSchema', () => {
  it('validates a minimal spec', () => {
    const spec = ConnectionSpecSchema.parse({
      baseUrl: 'https://api.example.com',
      format: 'openapi',
    });
    expect(spec.baseUrl).toBe('https://api.example.com');
    expect(spec.format).toBe('openapi');
  });

  it('validates a full spec with auth, sync, and filter', () => {
    const spec = ConnectionSpecSchema.parse({
      baseUrl: 'https://api.example.com',
      specUrl: 'https://api.example.com/openapi.json',
      format: 'openapi',
      auth: {type: 'bearer', token: 'env:API_TOKEN'},
      sync: {auto: true, frequency: 'on_push', notify_drift: true},
      filter: {
        tags: ['deals', 'contacts'],
        exclude_paths: ['/admin/*'],
      },
    });
    expect(spec.auth?.type).toBe('bearer');
    expect(spec.sync?.frequency).toBe('on_push');
    expect(spec.filter?.tags).toEqual(['deals', 'contacts']);
  });

  it('supports graphql and grpc formats', () => {
    expect(ConnectionSpecSchema.parse({baseUrl: 'x', format: 'graphql'}).format).toBe('graphql');
    expect(ConnectionSpecSchema.parse({baseUrl: 'x', format: 'grpc'}).format).toBe('grpc');
  });

  it('rejects invalid format', () => {
    expect(() => ConnectionSpecSchema.parse({baseUrl: 'x', format: 'soap'})).toThrow();
  });

  it('rejects empty baseUrl', () => {
    expect(() => ConnectionSpecSchema.parse({baseUrl: '', format: 'openapi'})).toThrow();
  });

  it('applies sync defaults', () => {
    const spec = ConnectionSpecSchema.parse({
      baseUrl: 'x',
      format: 'openapi',
      sync: {},
    });
    expect(spec.sync?.auto).toBe(true);
    expect(spec.sync?.frequency).toBe('on_push');
    expect(spec.sync?.notify_drift).toBe(true);
  });
});

describe('EndpointAccessSchema', () => {
  it('validates read-only endpoint', () => {
    const ea = EndpointAccessSchema.parse({returns: ['deal']});
    expect(ea.returns).toEqual(['deal']);
    expect(ea.confirm).toBeUndefined();
  });

  it('validates confirm: true', () => {
    const ea = EndpointAccessSchema.parse({returns: ['deal'], confirm: true});
    expect(ea.confirm).toBe(true);
  });

  it('validates confirm: review with reason', () => {
    const ea = EndpointAccessSchema.parse({
      returns: ['trade'],
      confirm: 'review',
      reason: 'Executes a live trade',
    });
    expect(ea.confirm).toBe('review');
    expect(ea.reason).toBe('Executes a live trade');
  });

  it('validates confirm: never', () => {
    const ea = EndpointAccessSchema.parse({returns: ['trade'], confirm: 'never'});
    expect(ea.confirm).toBe('never');
  });

  it('validates thresholds', () => {
    const ea = EndpointAccessSchema.parse({
      returns: ['transfer'],
      confirm: 'review',
      thresholds: [
        {field: 'amount', above: 10000, escalate: 'review'},
        {field: 'amount', above: 1000000, escalate: 'never'},
      ],
    });
    expect(ea.thresholds).toHaveLength(2);
    expect(ea.thresholds![0].above).toBe(10000);
  });
});

describe('FieldRestrictionSchema', () => {
  it('validates never_retrieve', () => {
    const fr = FieldRestrictionSchema.parse({
      entity: 'contact',
      field: 'ssn',
      policy: 'never_retrieve',
      sensitivity: 'pii_identifier',
    });
    expect(fr.policy).toBe('never_retrieve');
  });

  it('validates retrieve_but_redact with reason', () => {
    const fr = FieldRestrictionSchema.parse({
      entity: 'contact',
      field: 'income',
      policy: 'retrieve_but_redact',
      sensitivity: 'financial',
      reason: 'deal sizing',
    });
    expect(fr.reason).toBe('deal sizing');
  });

  it('validates role_gated with allowedRoles', () => {
    const fr = FieldRestrictionSchema.parse({
      entity: 'deal',
      field: 'margin',
      policy: 'role_gated',
      sensitivity: 'financial',
      allowedRoles: ['manager', 'vp_sales'],
      group: 'financial',
    });
    expect(fr.allowedRoles).toEqual(['manager', 'vp_sales']);
    expect(fr.group).toBe('financial');
  });

  it('rejects invalid policy', () => {
    expect(() =>
      FieldRestrictionSchema.parse({
        entity: 'x',
        field: 'y',
        policy: 'unknown',
        sensitivity: 's',
      }),
    ).toThrow();
  });
});

describe('ScopingRuleSchema', () => {
  it('validates field_match', () => {
    const rule = ScopingRuleSchema.parse({
      type: 'field_match',
      userContextField: 'owned_deals',
      label: 'your deals',
    });
    expect(rule.type).toBe('field_match');
  });

  it('validates all', () => {
    const rule = ScopingRuleSchema.parse({
      type: 'all',
      label: 'all company deals',
    });
    expect(rule.type).toBe('all');
  });

  it('validates through_relation', () => {
    const rule = ScopingRuleSchema.parse({
      type: 'through_relation',
      throughEntity: 'deal',
    });
    expect(rule.type).toBe('through_relation');
  });
});

describe('ThresholdSchema', () => {
  it('validates a threshold', () => {
    const t = ThresholdSchema.parse({field: 'amount', above: 10000, escalate: 'review'});
    expect(t.field).toBe('amount');
    expect(t.above).toBe(10000);
  });

  it('rejects invalid escalate value', () => {
    expect(() => ThresholdSchema.parse({field: 'x', above: 1, escalate: 'allow'})).toThrow();
  });
});

describe('AlternativeLookupSchema', () => {
  it('validates an alternative lookup', () => {
    const al = AlternativeLookupSchema.parse({
      restrictedField: 'contact.ssn',
      alternativeEndpoint: 'POST /contacts/verify-identity',
      description: 'Last 4 digits match',
    });
    expect(al.restrictedField).toBe('contact.ssn');
  });
});

describe('AccessConfigSchema', () => {
  it('validates a full access config', () => {
    const access = AccessConfigSchema.parse({
      endpoints: {
        'GET /deals': {returns: ['deal']},
        'PUT /deals/{id}': {returns: ['deal'], confirm: true},
      },
      fieldRestrictions: [
        {entity: 'contact', field: 'ssn', policy: 'never_retrieve', sensitivity: 'pii_identifier'},
      ],
      rowScoping: {
        deal: {
          rep: {type: 'field_match', userContextField: 'owned_deals', label: 'your deals'},
          vp_sales: {type: 'all', label: 'all deals'},
        },
      },
      delegations: {enabled: true, maxDurationDays: 90, escalateConfirm: true},
      alternativeLookups: [
        {restrictedField: 'contact.ssn', alternativeEndpoint: 'POST /contacts/verify'},
      ],
    });
    expect(Object.keys(access.endpoints)).toHaveLength(2);
    expect(access.fieldRestrictions).toHaveLength(1);
    expect(access.delegations?.enabled).toBe(true);
  });

  it('validates minimal access config (endpoints only)', () => {
    const access = AccessConfigSchema.parse({
      endpoints: {'GET /health': {returns: ['status']}},
    });
    expect(access.fieldRestrictions).toBeUndefined();
    expect(access.rowScoping).toBeUndefined();
  });
});
