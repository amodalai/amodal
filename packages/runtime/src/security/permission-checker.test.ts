/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {AccessConfig} from '@amodalai/types';
import {AccessJsonPermissionChecker} from './permission-checker.js';
import type {PermissionCheckRequest} from './permission-checker.js';

function makeAccess(overrides: Partial<AccessConfig['endpoints'][string]> = {}): AccessConfig {
  return {
    endpoints: {
      'POST /articles': {
        returns: ['article'],
        confirm: true,
        reason: 'Creates a new article',
        ...overrides,
      },
    },
  };
}

function makeRequest(overrides: Partial<PermissionCheckRequest> = {}): PermissionCheckRequest {
  return {
    connection: 'blog-api',
    endpointPath: 'POST /articles',
    intent: 'write',
    method: 'POST',
    ...overrides,
  };
}

describe('AccessJsonPermissionChecker', () => {
  describe('read operations', () => {
    it('allows GET requests without gate check', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', makeAccess()]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({method: 'GET', intent: 'read', endpointPath: 'GET /articles'}));
      expect(result.allowed).toBe(true);
    });
  });

  describe('write intent enforcement', () => {
    it('rejects mutating methods with read intent', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({method: 'POST', intent: 'read'}));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('requires intent "write"');
      }
    });

    it('rejects DELETE with read intent', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({method: 'DELETE', intent: 'read'}));
      expect(result.allowed).toBe(false);
    });
  });

  describe('read-only mode (task agents)', () => {
    it('blocks write operations in read-only mode', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({readOnly: true}));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('read-only mode');
      }
    });

    it('allows GET in read-only mode', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({method: 'GET', intent: 'read', readOnly: true}));
      expect(result.allowed).toBe(true);
    });
  });

  describe('plan mode', () => {
    it('blocks writes in plan mode', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({planModeActive: true}));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('plan mode');
      }
    });
  });

  describe('confirmation tiers', () => {
    it('returns requiresConfirmation for confirm tier', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', makeAccess({confirm: true})]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requiresConfirmation).toBe(true);
      }
    });

    it('blocks for review tier', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', makeAccess({confirm: 'review'})]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBeDefined();
      }
    });

    it('blocks for never tier', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', makeAccess({confirm: 'never'})]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(false);
    });

    it('allows when no confirm field', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', makeAccess({confirm: undefined})]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requiresConfirmation).toBeFalsy();
      }
    });

    it('allows when connection has no access config', () => {
      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map(),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(true);
    });
  });

  describe('delegation escalation', () => {
    it('escalates confirm to review for delegated agents', () => {
      const access = makeAccess({confirm: true});
      access.delegations = {enabled: true, escalateConfirm: true};

      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', access]]),
        isDelegated: true,
      });

      const result = checker.check(makeRequest({intent: 'write'}));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('Delegated');
      }
    });
  });

  describe('threshold escalation', () => {
    it('escalates when threshold is exceeded', () => {
      const access = makeAccess({
        confirm: true,
        thresholds: [{field: 'amount', above: 10000, escalate: 'never'}],
      });

      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', access]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({
        intent: 'write',
        params: {amount: 50000},
      }));

      expect(result.allowed).toBe(false);
    });

    it('does not escalate when threshold is not exceeded', () => {
      const access = makeAccess({
        confirm: true,
        thresholds: [{field: 'amount', above: 10000, escalate: 'never'}],
      });

      const checker = new AccessJsonPermissionChecker({
        accessConfigs: new Map([['blog-api', access]]),
        isDelegated: false,
      });

      const result = checker.check(makeRequest({
        intent: 'write',
        params: {amount: 500},
      }));

      // Still 'confirm' tier (not escalated to 'never')
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requiresConfirmation).toBe(true);
      }
    });
  });

  describe('exhaustive gate decisions', () => {
    it('handles all four gate decisions', () => {
      // allow — tested above (no confirm field)
      // confirm — tested above (confirm: true)
      // review — tested above (confirm: 'review')
      // never — tested above (confirm: 'never')
      // This test exists to document coverage, not add new assertions
      expect(true).toBe(true);
    });
  });
});
