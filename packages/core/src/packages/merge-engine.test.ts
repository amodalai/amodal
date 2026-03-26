/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';

import {
  deepMergeLocalWins,
  extractHeadingSections,
  filterEndpoints,
  mergeAccessJson,
  mergeConcatenation,
  mergeEntities,
  mergeSpecJson,
  mergeSurface,
  narrowRoles,
  tighterConfirm,
  tighterPolicy,
} from './merge-engine.js';
import type {SurfaceEndpoint} from '../repo/connection-types.js';

// --- spec.json ---

describe('deepMergeLocalWins', () => {
  it('merges nested objects', () => {
    const base = {a: {b: 1, c: 2}, d: 3};
    const local = {a: {b: 10}};
    const result = deepMergeLocalWins(base, local);
    expect(result).toEqual({a: {b: 10, c: 2}, d: 3});
  });

  it('replaces arrays entirely', () => {
    const base = {tags: ['a', 'b', 'c']};
    const local = {tags: ['x']};
    const result = deepMergeLocalWins(base, local);
    expect(result).toEqual({tags: ['x']});
  });

  it('adds new keys from local', () => {
    const base = {a: 1};
    const local = {b: 2};
    const result = deepMergeLocalWins(base, local);
    expect(result).toEqual({a: 1, b: 2});
  });

  it('handles deep nesting', () => {
    const base = {a: {b: {c: {d: 1}}}};
    const local = {a: {b: {c: {e: 2}}}};
    const result = deepMergeLocalWins(base, local);
    expect(result).toEqual({a: {b: {c: {d: 1, e: 2}}}});
  });
});

describe('mergeSpecJson', () => {
  const baseSpec = JSON.stringify({
    source: 'https://api.example.com/openapi.json',
    format: 'openapi',
    sync: {auto: true, frequency: 'on_push', notify_drift: true},
    filter: {tags: ['a', 'b', 'c']},
  });

  it('merges local overrides on top of base', () => {
    const local = JSON.stringify({
      import: 'example',
      auth: {type: 'bearer', token: 'env:TOKEN'},
      filter: {tags: ['a']},
    });
    const result = mergeSpecJson(baseSpec, local);
    expect(result.source).toBe('https://api.example.com/openapi.json');
    expect(result.format).toBe('openapi');
    expect(result.auth).toEqual({type: 'bearer', token: 'env:TOKEN'});
    expect(result.filter!.tags).toEqual(['a']);
    expect(result.sync!.auto).toBe(true);
  });

  it('strips import key from local', () => {
    const local = JSON.stringify({import: 'example', format: 'graphql'});
    const result = mergeSpecJson(baseSpec, local);
    expect(result.format).toBe('graphql');
  });

  it('passes through base when local has no overrides', () => {
    const local = JSON.stringify({import: 'example'});
    const result = mergeSpecJson(baseSpec, local);
    expect(result.source).toBe('https://api.example.com/openapi.json');
    expect(result.filter!.tags).toEqual(['a', 'b', 'c']);
  });

  it('handles nested sync override', () => {
    const local = JSON.stringify({import: 'example', sync: {frequency: 'daily'}});
    const result = mergeSpecJson(baseSpec, local);
    expect(result.sync!.frequency).toBe('daily');
    expect(result.sync!.auto).toBe(true);
  });
});

// --- surface.md ---

describe('filterEndpoints', () => {
  const endpoints: SurfaceEndpoint[] = [
    {method: 'GET', path: '/foo', description: '', included: true},
    {method: 'POST', path: '/foo', description: '', included: true},
    {method: 'GET', path: '/bar', description: '', included: true},
  ];

  it('filters by only list', () => {
    const result = filterEndpoints(endpoints, {only: ['GET /foo']});
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('GET');
    expect(result[0].path).toBe('/foo');
  });

  it('filters by exclude list', () => {
    const result = filterEndpoints(endpoints, {exclude: ['GET /foo']});
    expect(result).toHaveLength(2);
  });

  it('returns all when no filter', () => {
    const result = filterEndpoints(endpoints, {});
    expect(result).toHaveLength(3);
  });
});

describe('mergeSurface', () => {
  const baseMd = [
    '## Included',
    '### GET /foo',
    'Base description of GET /foo.',
    '### POST /foo',
    'Base description of POST /foo.',
    '### GET /bar',
    'Base description of GET /bar.',
  ].join('\n');

  it('filters base with only and appends local additions', () => {
    const localMd = [
      '---',
      'import: test',
      'only:',
      '  - GET /foo',
      '---',
      '',
      '### GET /foo',
      'Additional local guidance.',
    ].join('\n');

    const result = mergeSurface(baseMd, localMd);
    expect(result).toContain('### GET /foo');
    expect(result).toContain('Base description of GET /foo.');
    expect(result).toContain('Additional local guidance.');
    expect(result).not.toContain('### POST /foo');
    expect(result).not.toContain('### GET /bar');
  });

  it('excludes endpoints', () => {
    const localMd = '---\nimport: test\nexclude:\n  - GET /bar\n---\n';
    const result = mergeSurface(baseMd, localMd);
    expect(result).toContain('### GET /foo');
    expect(result).toContain('### POST /foo');
    expect(result).not.toContain('### GET /bar');
  });

  it('imports full surface with no filter', () => {
    const localMd = '---\nimport: test\n---\n';
    const result = mergeSurface(baseMd, localMd);
    expect(result).toContain('### GET /foo');
    expect(result).toContain('### POST /foo');
    expect(result).toContain('### GET /bar');
  });

  it('adds new local endpoints not in base', () => {
    const localMd = [
      '---',
      'import: test',
      '---',
      '',
      '### DELETE /baz',
      'Local-only endpoint.',
    ].join('\n');
    const result = mergeSurface(baseMd, localMd);
    expect(result).toContain('### DELETE /baz');
    expect(result).toContain('Local-only endpoint.');
  });
});

// --- access.json ---

describe('tighterConfirm', () => {
  it('tightens from undefined to true', () => {
    expect(tighterConfirm(undefined, true)).toBe(true);
  });

  it('tightens from undefined to review', () => {
    expect(tighterConfirm(undefined, 'review')).toBe('review');
  });

  it('tightens from true to review', () => {
    expect(tighterConfirm(true, 'review')).toBe('review');
  });

  it('tightens from true to never', () => {
    expect(tighterConfirm(true, 'never')).toBe('never');
  });

  it('ignores loosening from review to true', () => {
    expect(tighterConfirm('review', true)).toBe('review');
  });

  it('ignores loosening from never to review', () => {
    expect(tighterConfirm('never', 'review')).toBe('never');
  });

  it('keeps base when local is undefined', () => {
    expect(tighterConfirm('review', undefined)).toBe('review');
  });
});

describe('tighterPolicy', () => {
  it('tightens from role_gated to retrieve_but_redact', () => {
    expect(tighterPolicy('role_gated', 'retrieve_but_redact')).toBe('retrieve_but_redact');
  });

  it('tightens from role_gated to never_retrieve', () => {
    expect(tighterPolicy('role_gated', 'never_retrieve')).toBe('never_retrieve');
  });

  it('tightens from retrieve_but_redact to never_retrieve', () => {
    expect(tighterPolicy('retrieve_but_redact', 'never_retrieve')).toBe('never_retrieve');
  });

  it('ignores loosening from never_retrieve to role_gated', () => {
    expect(tighterPolicy('never_retrieve', 'role_gated')).toBe('never_retrieve');
  });

  it('keeps same level', () => {
    expect(tighterPolicy('review' as 'role_gated', 'review' as 'role_gated')).toBe('review');
  });
});

describe('narrowRoles', () => {
  it('returns intersection of both lists', () => {
    expect(narrowRoles(['admin', 'manager', 'analyst'], ['admin', 'analyst'])).toEqual([
      'admin',
      'analyst',
    ]);
  });

  it('returns local when base is undefined', () => {
    expect(narrowRoles(undefined, ['admin'])).toEqual(['admin']);
  });

  it('returns base when local is undefined', () => {
    expect(narrowRoles(['admin'], undefined)).toEqual(['admin']);
  });

  it('returns undefined when both undefined', () => {
    expect(narrowRoles(undefined, undefined)).toBeUndefined();
  });

  it('returns empty when no overlap', () => {
    expect(narrowRoles(['admin'], ['analyst'])).toEqual([]);
  });
});

describe('mergeAccessJson', () => {
  const baseAccess = JSON.stringify({
    endpoints: {
      'PUT /foo': {returns: ['entity'], confirm: true},
      'DELETE /foo': {returns: ['entity'], confirm: 'never'},
    },
    fieldRestrictions: [
      {entity: 'contact', field: 'email', policy: 'role_gated', sensitivity: 'pii', allowedRoles: ['admin', 'manager']},
      {entity: 'contact', field: 'phone', policy: 'never_retrieve', sensitivity: 'pii'},
    ],
  });

  it('tightens endpoint confirm tier', () => {
    const local = JSON.stringify({
      import: 'test',
      endpoints: {'PUT /foo': {confirm: 'review'}},
    });
    const result = mergeAccessJson(baseAccess, local);
    expect(result.endpoints['PUT /foo'].confirm).toBe('review');
  });

  it('allows local override to loosen confirm tier', () => {
    const local = JSON.stringify({
      import: 'test',
      endpoints: {'DELETE /foo': {confirm: true}},
    });
    const result = mergeAccessJson(baseAccess, local);
    expect(result.endpoints['DELETE /foo'].confirm).toBe(true);
  });

  it('adds new endpoint restrictions', () => {
    const local = JSON.stringify({
      import: 'test',
      endpoints: {'POST /bar': {returns: ['bar'], confirm: 'review'}},
    });
    const result = mergeAccessJson(baseAccess, local);
    expect(result.endpoints['POST /bar']).toBeDefined();
  });

  it('adds new field restrictions', () => {
    const local = JSON.stringify({
      import: 'test',
      fieldRestrictions: [
        {entity: 'opportunity', field: 'margin', policy: 'role_gated', sensitivity: 'financial', allowedRoles: ['vp_sales']},
      ],
    });
    const result = mergeAccessJson(baseAccess, local);
    expect(result.fieldRestrictions).toHaveLength(3);
  });

  it('tightens existing field restriction policy', () => {
    const local = JSON.stringify({
      import: 'test',
      fieldRestrictions: [
        {entity: 'contact', field: 'email', policy: 'retrieve_but_redact', sensitivity: 'pii'},
      ],
    });
    const result = mergeAccessJson(baseAccess, local);
    const emailRestr = result.fieldRestrictions!.find((r) => r.field === 'email');
    expect(emailRestr!.policy).toBe('retrieve_but_redact');
  });

  it('narrows allowed roles for field restriction', () => {
    const local = JSON.stringify({
      import: 'test',
      fieldRestrictions: [
        {entity: 'contact', field: 'email', policy: 'role_gated', sensitivity: 'pii', allowedRoles: ['admin']},
      ],
    });
    const result = mergeAccessJson(baseAccess, local);
    const emailRestr = result.fieldRestrictions!.find((r) => r.field === 'email');
    expect(emailRestr!.allowedRoles).toEqual(['admin']);
  });

  it('preserves untouched base restrictions', () => {
    const local = JSON.stringify({import: 'test'});
    const result = mergeAccessJson(baseAccess, local);
    expect(result.fieldRestrictions).toHaveLength(2);
    expect(result.endpoints['PUT /foo'].confirm).toBe(true);
  });
});

// --- entities.md ---

describe('extractHeadingSections', () => {
  it('extracts sections by ### heading', () => {
    const content = 'Preamble\n### A\nContent A\n### B\nContent B';
    const {preamble, sections} = extractHeadingSections(content);
    expect(preamble).toBe('Preamble');
    expect(sections.get('A')).toBe('Content A');
    expect(sections.get('B')).toBe('Content B');
  });

  it('handles no headings', () => {
    const {preamble, sections} = extractHeadingSections('Just text');
    expect(preamble).toBe('Just text');
    expect(sections.size).toBe(0);
  });
});

describe('mergeEntities', () => {
  it('replaces matching sections from local', () => {
    const base = '### Opportunity\nBase opp\n### Account\nBase account';
    const local = '---\nimport: test\n---\n### Opportunity\nLocal opp';
    const result = mergeEntities(base, local);
    expect(result).toContain('Local opp');
    expect(result).not.toContain('Base opp');
    expect(result).toContain('Base account');
  });

  it('passes through unmatched base sections', () => {
    const base = '### Opportunity\nBase opp\n### Contact\nBase contact';
    const local = '---\nimport: test\n---\n### Opportunity\nOverridden';
    const result = mergeEntities(base, local);
    expect(result).toContain('Base contact');
  });

  it('adds new local sections', () => {
    const base = '### A\nContent A';
    const local = '---\nimport: test\n---\n### B\nContent B';
    const result = mergeEntities(base, local);
    expect(result).toContain('### A');
    expect(result).toContain('### B');
  });

  it('preserves base preamble', () => {
    const base = '# Entities\n\n### A\nContent A';
    const local = '---\nimport: test\n---\n### A\nOverridden';
    const result = mergeEntities(base, local);
    expect(result).toContain('# Entities');
  });
});

// --- Concatenation ---

describe('mergeConcatenation', () => {
  it('concatenates base and local with blank line', () => {
    const base = '# Rules\n\n- Rule 1';
    const local = '---\nimport: test\n---\n# Local Rules\n\n- Rule 2';
    const result = mergeConcatenation(base, local);
    expect(result).toBe('# Rules\n\n- Rule 1\n\n# Local Rules\n\n- Rule 2');
  });

  it('returns base when local body is empty', () => {
    const base = '# Rules\n\n- Rule 1';
    const local = '---\nimport: test\n---\n';
    const result = mergeConcatenation(base, local);
    expect(result).toBe('# Rules\n\n- Rule 1');
  });

  it('returns local body when base is empty', () => {
    const result = mergeConcatenation('', '---\nimport: test\n---\nLocal content');
    expect(result).toBe('Local content');
  });

  it('strips frontmatter from local', () => {
    const base = 'Base';
    const local = '---\nimport: test\nother: val\n---\nLocal';
    const result = mergeConcatenation(base, local);
    expect(result).toBe('Base\n\nLocal');
    expect(result).not.toContain('---');
  });
});
