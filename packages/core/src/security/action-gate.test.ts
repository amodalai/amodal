/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {ActionGate} from './action-gate.js';
import type {AccessConfig} from '../repo/connection-schemas.js';

function makeAccessConfig(
  overrides: Partial<AccessConfig> = {},
): AccessConfig {
  return {
    endpoints: {
      'POST /api/contacts': {
        returns: ['contact'],
        confirm: true,
        reason: 'Creates a contact',
      },
      'DELETE /api/contacts/{id}': {
        returns: ['contact'],
        confirm: 'review',
        reason: 'Deletes a contact',
      },
      'POST /api/transfers': {
        returns: ['transfer'],
        confirm: true,
        reason: 'Initiates a transfer',
        thresholds: [
          {field: 'amount', above: 10000, escalate: 'review'},
          {field: 'amount', above: 100000, escalate: 'never'},
        ],
      },
      'GET /api/contacts': {
        returns: ['contact'],
      },
    },
    ...overrides,
  };
}

describe('ActionGate', () => {
  it('returns allow for unknown endpoint', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/unknown', 'crm');
    expect(result.decision).toBe('allow');
    expect(result.escalated).toBe(false);
  });

  it('returns allow for unknown connection', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/contacts', 'unknown');
    expect(result.decision).toBe('allow');
  });

  it('returns confirm for confirm: true', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/contacts', 'crm');
    expect(result.decision).toBe('confirm');
    expect(result.reason).toBe('Creates a contact');
  });

  it('returns review for confirm: "review"', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('DELETE /api/contacts/{id}', 'crm');
    expect(result.decision).toBe('review');
  });

  it('returns allow for endpoint without confirm', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('GET /api/contacts', 'crm');
    expect(result.decision).toBe('allow');
  });

  it('escalates via threshold', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/transfers', 'crm', {
      amount: 50000,
    });
    expect(result.decision).toBe('review');
    expect(result.escalated).toBe(true);
  });

  it('escalates to never via high threshold', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/transfers', 'crm', {
      amount: 200000,
    });
    expect(result.decision).toBe('never');
    expect(result.escalated).toBe(true);
  });

  it('does not escalate when below threshold', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/transfers', 'crm', {
      amount: 500,
    });
    expect(result.decision).toBe('confirm');
    expect(result.escalated).toBe(false);
  });

  it('escalates confirm → review for delegated agent', () => {
    const config = makeAccessConfig({
      delegations: {
        enabled: true,
        escalateConfirm: true,
      },
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: true,
    });

    const result = gate.evaluate('POST /api/contacts', 'crm');
    expect(result.decision).toBe('review');
    expect(result.escalated).toBe(true);
  });

  it('does not escalate delegation when not delegated', () => {
    const config = makeAccessConfig({
      delegations: {
        enabled: true,
        escalateConfirm: true,
      },
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/contacts', 'crm');
    expect(result.decision).toBe('confirm');
    expect(result.escalated).toBe(false);
  });

  it('does not escalate delegation when escalateConfirm is false', () => {
    const config = makeAccessConfig({
      delegations: {
        enabled: true,
        escalateConfirm: false,
      },
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: true,
    });

    const result = gate.evaluate('POST /api/contacts', 'crm');
    expect(result.decision).toBe('confirm');
    expect(result.escalated).toBe(false);
  });

  it('returns endpointPath in result', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/contacts', 'crm');
    expect(result.endpointPath).toBe('POST /api/contacts');
  });

  it('threshold does not downgrade existing review', () => {
    const config = makeAccessConfig({
      endpoints: {
        'POST /api/critical': {
          returns: ['item'],
          confirm: 'review',
          thresholds: [
            // This would normally escalate to review, but it's already review
            {field: 'amount', above: 100, escalate: 'review'},
          ],
        },
      },
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/critical', 'crm', {
      amount: 200,
    });
    expect(result.decision).toBe('review');
  });

  it('skips threshold evaluation when no params', () => {
    const gate = new ActionGate({
      accessConfigs: new Map([['crm', makeAccessConfig()]]),
      isDelegated: false,
    });

    const result = gate.evaluate('POST /api/transfers', 'crm');
    expect(result.decision).toBe('confirm'); // base tier, no threshold check
  });

  it('handles confirm: "never"', () => {
    const config = makeAccessConfig({
      endpoints: {
        'DELETE /api/org': {
          returns: ['org'],
          confirm: 'never',
          reason: 'Org deletion is never allowed',
        },
      },
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: false,
    });

    const result = gate.evaluate('DELETE /api/org', 'crm');
    expect(result.decision).toBe('never');
    expect(result.reason).toBe('Org deletion is never allowed');
  });

  it('delegation does not escalate review to never', () => {
    const config = makeAccessConfig({
      delegations: {enabled: true, escalateConfirm: true},
    });

    const gate = new ActionGate({
      accessConfigs: new Map([['crm', config]]),
      isDelegated: true,
    });

    // review stays review (delegation only escalates confirm → review)
    const result = gate.evaluate('DELETE /api/contacts/{id}', 'crm');
    expect(result.decision).toBe('review');
  });
});
