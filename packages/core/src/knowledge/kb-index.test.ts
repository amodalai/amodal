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
    const result = formatKnowledgeIndex([]);
    expect(result).toContain('# Knowledge Base');
    expect(result).toContain('No knowledge base documents are available');
    expect(result).toContain('no connections have been configured');
  });

  it('formats app KB index', () => {
    const appDocs = [
      makeDoc({
        id: 'doc-1',
        title: 'API Docs',
        category: 'methodology',
        tags: ['api-docs', 'endpoints'],
      }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('# Available Knowledge Base');
    expect(result).toContain('load_knowledge');
    expect(result).toContain('## Application Knowledge (1 document)');
    expect(result).toContain('| API Docs | Methodology | api-docs, endpoints | doc-1 |');
  });

  it('formats multiple app docs', () => {
    const appDocs = [
      makeDoc({ id: 'doc-o1', title: 'Org Doc', category: 'methodology' }),
      makeDoc({
        id: 'doc-s1',
        title: 'Seg Doc',
        category: 'incident_history',
      }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('## Application Knowledge');
    expect(result).toContain('| Org Doc |');
    expect(result).toContain('| Seg Doc |');
  });

  it('shows dash for docs with no tags', () => {
    const appDocs = [
      makeDoc({ id: 'doc-1', title: 'No Tags', category: 'methodology', tags: [] }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('| No Tags | Methodology | - | doc-1 |');
  });

  it('pluralizes document count correctly', () => {
    const appDocs = [
      makeDoc({ id: 'doc-1', title: 'A', category: 'methodology' }),
      makeDoc({ id: 'doc-2', title: 'B', category: 'system_docs' }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('## Application Knowledge (2 documents)');
  });

  it('singular for one document', () => {
    const appDocs = [
      makeDoc({ id: 'doc-1', title: 'A', category: 'methodology' }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('(1 document)');
    expect(result).not.toContain('(1 documents)');
  });

  it('includes table headers', () => {
    const appDocs = [
      makeDoc({ id: 'doc-1', title: 'Test', category: 'methodology' }),
    ];
    const result = formatKnowledgeIndex(appDocs);
    expect(result).toContain('| Title | Category | Tags | ID |');
    expect(result).toContain('| --- | --- | --- | --- |');
  });

  it('maps category display names correctly', () => {
    const appDocs = [
      makeDoc({ id: '1', title: 'A', category: 'system_docs' }),
      makeDoc({ id: '2', title: 'B', category: 'methodology' }),
      makeDoc({ id: '3', title: 'C', category: 'patterns' }),
      makeDoc({ id: '4', title: 'D', category: 'false_positives' }),
      makeDoc({ id: '5', title: 'E', category: 'response_procedures' }),
      makeDoc({ id: '6', title: 'F', category: 'environment' }),
      makeDoc({ id: '7', title: 'G', category: 'baselines' }),
      makeDoc({ id: '8', title: 'H', category: 'team' }),
      makeDoc({ id: '9', title: 'I', category: 'incident_history' }),
    ];
    const result = formatKnowledgeIndex(appDocs);
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
});
