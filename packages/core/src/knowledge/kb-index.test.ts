/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  buildKnowledgeIndex,
  formatKnowledgeIndex,
} from './kb-index.js';
import type { KBDocument } from './kb-types.js';

function makeDoc(
  overrides: Partial<KBDocument> & Pick<KBDocument, 'title' | 'category'>,
): KBDocument {
  return {
    id: 'doc-1',
    scope_type: 'application',
    scope_id: 'org-1',
    body: 'Some body content.',
    tags: [],
    status: 'active',
    created_by: 'admin',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildKnowledgeIndex', () => {
  it('returns empty array for empty docs', () => {
    expect(buildKnowledgeIndex([])).toEqual([]);
  });

  it('builds index entries with correct fields', () => {
    const docs = [
      makeDoc({
        id: 'doc-1',
        title: 'API Docs',
        category: 'methodology',
        tags: ['api-docs', 'endpoints'],
      }),
    ];
    const index = buildKnowledgeIndex(docs);
    expect(index).toHaveLength(1);
    expect(index[0]).toEqual({
      id: 'doc-1',
      title: 'API Docs',
      category: 'methodology',
      tags: ['api-docs', 'endpoints'],
      scope_type: 'application',
    });
  });

  it('does not include body in index entries', () => {
    const docs = [
      makeDoc({ title: 'Test', category: 'methodology', body: 'long body' }),
    ];
    const index = buildKnowledgeIndex(docs);
    expect(index[0]).not.toHaveProperty('body');
  });

  it('preserves multiple docs', () => {
    const docs = [
      makeDoc({ id: 'doc-1', title: 'A', category: 'methodology' }),
      makeDoc({ id: 'doc-2', title: 'B', category: 'system_docs', tags: ['t1'] }),
    ];
    const index = buildKnowledgeIndex(docs);
    expect(index).toHaveLength(2);
    expect(index[0].id).toBe('doc-1');
    expect(index[1].id).toBe('doc-2');
  });
});

describe('formatKnowledgeIndex', () => {
  it('returns no-connections guidance when no documents', () => {
    const result = formatKnowledgeIndex([], []);
    expect(result).toContain('# Knowledge Base');
    expect(result).toContain('No knowledge base documents are available');
    expect(result).toContain('no connections have been configured');
  });

  it('formats org-only KB index', () => {
    const orgDocs = [
      makeDoc({
        id: 'doc-1',
        title: 'API Docs',
        category: 'methodology',
        tags: ['api-docs', 'endpoints'],
      }),
    ];
    const result = formatKnowledgeIndex(orgDocs, []);
    expect(result).toContain('# Available Knowledge Base');
    expect(result).toContain('load_knowledge');
    expect(result).toContain('## Application Knowledge (1 document)');
    expect(result).toContain('| API Docs | Methodology | api-docs, endpoints | doc-1 |');
    expect(result).not.toContain('## Tenant Knowledge');
  });

  it('formats segment-only KB index', () => {
    const segDocs = [
      makeDoc({
        scope_type: 'tenant',
        id: 'doc-s1',
        title: 'Zone Layout',
        category: 'team',
        tags: ['zones'],
      }),
    ];
    const result = formatKnowledgeIndex([], segDocs);
    expect(result).toContain('## Tenant Knowledge (1 document)');
    expect(result).toContain('| Zone Layout | Team | zones | doc-s1 |');
    expect(result).not.toContain('## Application Knowledge');
  });

  it('formats both org and segment KB index', () => {
    const orgDocs = [
      makeDoc({ id: 'doc-o1', title: 'Org Doc', category: 'methodology' }),
    ];
    const segDocs = [
      makeDoc({
        scope_type: 'tenant',
        id: 'doc-s1',
        title: 'Seg Doc',
        category: 'incident_history',
      }),
    ];
    const result = formatKnowledgeIndex(orgDocs, segDocs);
    expect(result).toContain('## Application Knowledge');
    expect(result).toContain('## Tenant Knowledge');
    const orgIdx = result.indexOf('## Application Knowledge');
    const segIdx = result.indexOf('## Tenant Knowledge');
    expect(orgIdx).toBeLessThan(segIdx);
  });

  it('shows dash for docs with no tags', () => {
    const orgDocs = [
      makeDoc({ id: 'doc-1', title: 'No Tags', category: 'methodology', tags: [] }),
    ];
    const result = formatKnowledgeIndex(orgDocs, []);
    expect(result).toContain('| No Tags | Methodology | - | doc-1 |');
  });

  it('pluralizes document count correctly', () => {
    const orgDocs = [
      makeDoc({ id: 'doc-1', title: 'A', category: 'methodology' }),
      makeDoc({ id: 'doc-2', title: 'B', category: 'system_docs' }),
    ];
    const result = formatKnowledgeIndex(orgDocs, []);
    expect(result).toContain('## Application Knowledge (2 documents)');
  });

  it('singular for one document', () => {
    const orgDocs = [
      makeDoc({ id: 'doc-1', title: 'A', category: 'methodology' }),
    ];
    const result = formatKnowledgeIndex(orgDocs, []);
    expect(result).toContain('(1 document)');
    expect(result).not.toContain('(1 documents)');
  });

  it('includes table headers', () => {
    const orgDocs = [
      makeDoc({ id: 'doc-1', title: 'Test', category: 'methodology' }),
    ];
    const result = formatKnowledgeIndex(orgDocs, []);
    expect(result).toContain('| Title | Category | Tags | ID |');
    expect(result).toContain('| --- | --- | --- | --- |');
  });

  it('maps new category display names correctly', () => {
    const orgDocs = [
      makeDoc({ id: '1', title: 'A', category: 'system_docs' }),
      makeDoc({ id: '2', title: 'B', category: 'methodology' }),
      makeDoc({ id: '3', title: 'C', category: 'patterns' }),
      makeDoc({ id: '4', title: 'D', category: 'false_positives' }),
      makeDoc({ id: '5', title: 'E', category: 'response_procedures' }),
    ];
    const segDocs = [
      makeDoc({ id: '6', scope_type: 'tenant', title: 'F', category: 'environment' }),
      makeDoc({ id: '7', scope_type: 'tenant', title: 'G', category: 'baselines' }),
      makeDoc({ id: '8', scope_type: 'tenant', title: 'H', category: 'team' }),
      makeDoc({ id: '9', scope_type: 'tenant', title: 'I', category: 'incident_history' }),
    ];
    const result = formatKnowledgeIndex(orgDocs, segDocs);
    expect(result).toContain('System Documentation');
    expect(result).toContain('Methodology');
    expect(result).toContain('Patterns');
    expect(result).toContain('False Positive Patterns');
    expect(result).toContain('Response Procedures');
    expect(result).toContain('Environment');
    expect(result).toContain('Baselines');
    expect(result).toContain('Team');
    expect(result).toContain('Incident History');
  });

  it('displays current categories correctly', () => {
    const orgDocs = [
      makeDoc({ id: '1', title: 'A', category: 'methodology' }),
      makeDoc({ id: '2', title: 'B', category: 'system_docs' }),
    ];
    const segDocs = [
      makeDoc({ id: '3', scope_type: 'tenant', title: 'C', category: 'team' }),
      makeDoc({ id: '4', scope_type: 'tenant', title: 'D', category: 'incident_history' }),
    ];
    const result = formatKnowledgeIndex(orgDocs, segDocs);
    expect(result).toContain('Methodology');
    expect(result).toContain('System Documentation');
    expect(result).toContain('Team');
    expect(result).toContain('Incident History');
  });
});
