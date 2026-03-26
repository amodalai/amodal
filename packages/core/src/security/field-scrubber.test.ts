/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {FieldScrubber} from './field-scrubber.js';
import {ScrubTracker} from './scrub-tracker.js';
import type {AccessConfig} from '../repo/connection-schemas.js';

function makeAccessConfig(
  overrides: Partial<AccessConfig> = {},
): AccessConfig {
  return {
    endpoints: {
      '/api/contacts': {
        returns: ['contact'],
      },
      '/api/deals': {
        returns: ['deal', 'contact'],
      },
    },
    fieldRestrictions: [
      {
        entity: 'contact',
        field: 'ssn',
        policy: 'never_retrieve',
        sensitivity: 'pii_identifier',
      },
      {
        entity: 'contact',
        field: 'name',
        policy: 'retrieve_but_redact',
        sensitivity: 'pii_name',
      },
      {
        entity: 'contact',
        field: 'salary',
        policy: 'role_gated',
        sensitivity: 'financial',
        allowedRoles: ['finance_admin'],
      },
    ],
    ...overrides,
  };
}

describe('FieldScrubber', () => {
  let tracker: ScrubTracker;

  beforeEach(() => {
    tracker = new ScrubTracker();
  });

  it('passes through data when no access config exists', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map(),
      userRoles: [],
      tracker,
    });

    const data = {contact: {ssn: '123-45-6789'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    expect(result.data).toEqual(data);
    expect(result.records).toHaveLength(0);
  });

  it('passes through data when endpoint not found', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {contact: {ssn: '123-45-6789'}};
    const result = scrubber.scrub(data, '/api/unknown', 'crm');

    expect(result.data).toEqual(data);
    expect(result.records).toHaveLength(0);
  });

  it('strips never_retrieve fields', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {contact: {ssn: '123-45-6789', email: 'a@b.com'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['ssn']).toBeUndefined();
    expect(scrubbed['contact']?.['email']).toBe('a@b.com');
    expect(result.strippedCount).toBe(1);
  });

  it('keeps retrieve_but_redact fields and records them', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {contact: {name: 'John Doe', email: 'a@b.com'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['name']).toBe('John Doe');
    expect(result.redactableCount).toBe(1);
  });

  it('strips role_gated fields when user lacks role', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: ['analyst'],
      tracker,
    });

    const data = {contact: {salary: 150000, email: 'a@b.com'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['salary']).toBeUndefined();
    expect(result.strippedCount).toBe(1);
  });

  it('keeps role_gated fields when user has role', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: ['finance_admin'],
      tracker,
    });

    const data = {contact: {salary: 150000, email: 'a@b.com'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['salary']).toBe(150000);
    expect(result.redactableCount).toBe(1);
  });

  it('handles arrays of entities', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      contacts: [
        {ssn: '111-22-3333', email: 'a@b.com'},
        {ssn: '444-55-6666', email: 'c@d.com'},
      ],
    };
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(scrubbed['contacts']).toHaveLength(2);
    expect(scrubbed['contacts']?.[0]?.['ssn']).toBeUndefined();
    expect(scrubbed['contacts']?.[1]?.['ssn']).toBeUndefined();
    expect(result.strippedCount).toBe(2);
  });

  it('handles nested entities via key hints', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      deal: {
        amount: 50000,
        contact: {ssn: '111-22-3333', name: 'Jane'},
      },
    };
    const result = scrubber.scrub(data, '/api/deals', 'crm');

    const scrubbed = result.data as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(scrubbed['deal']?.['contact']?.['ssn']).toBeUndefined();
    expect(scrubbed['deal']?.['contact']?.['name']).toBe('Jane');
  });

  it('writes records to tracker', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {contact: {ssn: '123-45-6789', name: 'John'}};
    scrubber.scrub(data, '/api/contacts', 'crm');

    expect(tracker.size).toBe(2);
    expect(tracker.getScrubbedValues().has('123-45-6789')).toBe(true);
    expect(tracker.getScrubbedValues().has('John')).toBe(true);
  });

  it('handles null data', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const result = scrubber.scrub(null, '/api/contacts', 'crm');
    expect(result.data).toBeNull();
    expect(result.records).toHaveLength(0);
  });

  it('handles primitive data', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const result = scrubber.scrub('hello', '/api/contacts', 'crm');
    expect(result.data).toBe('hello');
  });

  it('handles empty object', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const result = scrubber.scrub({}, '/api/contacts', 'crm');
    expect(result.data).toEqual({});
    expect(result.records).toHaveLength(0);
  });

  it('preserves non-restricted fields', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      contact: {
        ssn: '123-45-6789',
        email: 'a@b.com',
        phone: '555-1234',
      },
    };
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['email']).toBe('a@b.com');
    expect(scrubbed['contact']?.['phone']).toBe('555-1234');
  });

  it('handles endpoint with no matching field restrictions', () => {
    const config = makeAccessConfig({
      endpoints: {
        '/api/products': {returns: ['product']},
      },
    });

    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['store', config]]),
      userRoles: [],
      tracker,
    });

    const data = {product: {name: 'Widget', price: 9.99}};
    const result = scrubber.scrub(data, '/api/products', 'store');

    expect(result.data).toEqual(data);
    expect(result.records).toHaveLength(0);
  });

  it('role_gated with empty allowedRoles treats as never_retrieve', () => {
    const config = makeAccessConfig({
      fieldRestrictions: [
        {
          entity: 'contact',
          field: 'secret',
          policy: 'role_gated',
          sensitivity: 'financial',
          allowedRoles: [],
        },
      ],
    });

    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', config]]),
      userRoles: ['admin'],
      tracker,
    });

    const data = {contact: {secret: 'hidden'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['secret']).toBeUndefined();
  });

  it('role_gated without allowedRoles property treats as never_retrieve', () => {
    const config = makeAccessConfig({
      fieldRestrictions: [
        {
          entity: 'contact',
          field: 'secret',
          policy: 'role_gated',
          sensitivity: 'financial',
        },
      ],
    });

    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', config]]),
      userRoles: ['admin'],
      tracker,
    });

    const data = {contact: {secret: 'hidden'}};
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<string, Record<string, unknown>>;
    expect(scrubbed['contact']?.['secret']).toBeUndefined();
  });

  it('handles multiple connections independently', () => {
    const crmConfig = makeAccessConfig();
    const erpConfig = makeAccessConfig({
      endpoints: {'/api/employees': {returns: ['contact']}},
    });

    const scrubber = new FieldScrubber({
      accessConfigs: new Map([
        ['crm', crmConfig],
        ['erp', erpConfig],
      ]),
      userRoles: [],
      tracker,
    });

    const data1 = {contact: {ssn: '111-22-3333'}};
    const data2 = {contact: {ssn: '444-55-6666'}};

    scrubber.scrub(data1, '/api/contacts', 'crm');
    scrubber.scrub(data2, '/api/employees', 'erp');

    expect(tracker.size).toBe(2);
  });

  it('handles undefined values gracefully', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const result = scrubber.scrub(undefined, '/api/contacts', 'crm');
    expect(result.data).toBeUndefined();
  });

  it('returns correct combined counts', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      contact: {ssn: '123-45-6789', name: 'John', salary: 100000},
    };
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    // ssn = never_retrieve (stripped), name = retrieve_but_redact (redactable),
    // salary = role_gated no role (stripped)
    expect(result.strippedCount).toBe(2);
    expect(result.redactableCount).toBe(1);
    expect(result.records).toHaveLength(3);
  });

  it('handles deeply nested structures', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      result: {
        data: {
          contact: {ssn: '111-22-3333', email: 'a@b.com'},
        },
      },
    };
    const result = scrubber.scrub(data, '/api/contacts', 'crm');

    const scrubbed = result.data as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    expect(
      scrubbed['result']?.['data']?.['contact']?.['ssn'],
    ).toBeUndefined();
    expect(scrubbed['result']?.['data']?.['contact']?.['email']).toBe(
      'a@b.com',
    );
  });

  it('scrubs contact fields inside deals endpoint', () => {
    const scrubber = new FieldScrubber({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      userRoles: [],
      tracker,
    });

    const data = {
      deal: {
        id: 'D-1',
        amount: 50000,
        contact: {ssn: '999-88-7777', name: 'Alice'},
      },
    };
    const result = scrubber.scrub(data, '/api/deals', 'crm');

    const scrubbed = result.data as Record<
      string,
      Record<string, unknown>
    >;
    const contact = scrubbed['deal']?.['contact'] as Record<string, unknown>;
    expect(contact['ssn']).toBeUndefined();
    expect(contact['name']).toBe('Alice');
  });
});
