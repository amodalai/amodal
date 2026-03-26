/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {ScopeChecker} from './scope-checker.js';

describe('ScopeChecker', () => {
  it('flags unqualified aggregate for field_match entity', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
      },
      scopeLabels: {deal: 'qualified by owner'},
    });

    const violations = checker.check('All deals are closed this quarter');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.entity).toBe('deal');
    expect(violations[0]?.expectedQualification).toBe('qualified by owner');
  });

  it('flags "every" keyword', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
      },
      scopeLabels: {},
    });

    const violations = checker.check('Every deal has been reviewed');
    expect(violations).toHaveLength(1);
  });

  it('flags "total" keyword', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        contact: {type: 'through_relation', throughEntity: 'account'},
      },
      scopeLabels: {contact: 'scoped through account'},
    });

    const violations = checker.check('Total contact count is 500');
    expect(violations).toHaveLength(1);
  });

  it('does not flag type "all" scoping (no restriction)', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        product: {type: 'all'},
      },
      scopeLabels: {},
    });

    const violations = checker.check('All products are available');
    expect(violations).toHaveLength(0);
  });

  it('does not flag when no entity is mentioned near aggregate', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
      },
      scopeLabels: {},
    });

    const violations = checker.check('All items are ready');
    expect(violations).toHaveLength(0);
  });

  it('returns empty for clean text', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
      },
      scopeLabels: {},
    });

    const violations = checker.check('The specific deal D-123 is closed');
    expect(violations).toHaveLength(0);
  });

  it('handles empty scope rules', () => {
    const checker = new ScopeChecker({
      scopeRules: {},
      scopeLabels: {},
    });

    const violations = checker.check('All deals are closed');
    expect(violations).toHaveLength(0);
  });

  it('falls back to rule label when no scopeLabel', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {
          type: 'field_match',
          userContextField: 'owner_id',
          label: 'by owner',
        },
      },
      scopeLabels: {},
    });

    const violations = checker.check('All deals are closed');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.expectedQualification).toBe('by owner');
  });

  it('flags "across all" keyword', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
      },
      scopeLabels: {},
    });

    const violations = checker.check(
      'Revenue across all deals is $1M',
    );
    expect(violations).toHaveLength(1);
  });

  it('handles multiple entities', () => {
    const checker = new ScopeChecker({
      scopeRules: {
        deal: {type: 'field_match', userContextField: 'owner_id'},
        contact: {type: 'through_relation', throughEntity: 'account'},
      },
      scopeLabels: {},
    });

    const violations = checker.check(
      'All deal and contact records are synced',
    );
    expect(violations).toHaveLength(2);
  });
});
