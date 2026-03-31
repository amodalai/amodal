/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeStore } from './knowledge-store.js';
import type { KBDocument } from './kb-types.js';

function makeDoc(
  overrides: Partial<KBDocument> & Pick<KBDocument, 'id' | 'title'>,
): KBDocument {
  return {
    scope_type: 'application',
    scope_id: 'org-1',
    category: 'methodology',
    body: `Body of ${overrides.title}`,
    tags: [],
    status: 'active',
    created_by: 'admin',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const appDocs: KBDocument[] = [
  makeDoc({ id: 'org-1', title: 'API Docs', tags: ['api-docs', 'endpoints'] }),
  makeDoc({ id: 'org-2', title: 'Threat Patterns', tags: ['threat-patterns'] }),
  makeDoc({ id: 'org-3', title: 'False Positives', tags: ['false-positives', 'patterns'] }),
  makeDoc({ id: 'org-4', title: 'Suspicion Scoring', tags: ['suspicion-scoring'], category: 'system_docs' }),
  makeDoc({ id: 'org-5', title: 'Device Fingerprinting', tags: ['device-fingerprinting'] }),
  makeDoc({ id: 'org-6', title: 'Wireless Protocols', tags: ['wireless-protocols'] }),
];

const extraAppDocs: KBDocument[] = [
  makeDoc({
    id: 'seg-1',
    title: 'Facility Zones',
    scope_type: 'application',
    scope_id: 'seg-acme',
    tags: ['zones', 'local-baselines'],
    category: 'team',
  }),
  makeDoc({
    id: 'seg-2',
    title: 'Team Context',
    scope_type: 'application',
    scope_id: 'seg-acme',
    tags: ['team-context'],
    category: 'team',
  }),
  makeDoc({
    id: 'seg-3',
    title: 'Local Baselines',
    scope_type: 'application',
    scope_id: 'seg-acme',
    tags: ['local-baselines'],
  }),
];

let store: KnowledgeStore;

beforeEach(() => {
  store = new KnowledgeStore([...appDocs, ...extraAppDocs]);
});

describe('KnowledgeStore', () => {
  describe('getIndex', () => {
    it('returns index entries for all docs', () => {
      const index = store.getIndex();
      expect(index).toHaveLength(9);
      expect(index[0]).toHaveProperty('id');
      expect(index[0]).toHaveProperty('title');
      expect(index[0]).toHaveProperty('tags');
      expect(index[0]).not.toHaveProperty('body');
    });
  });

  describe('getFormattedIndex', () => {
    it('returns formatted markdown index', () => {
      const result = store.getFormattedIndex();
      expect(result).toContain('# Available Knowledge Base');
      expect(result).toContain('## Application Knowledge (9 documents)');
    });

    it('returns no-connections message when no docs', () => {
      const emptyStore = new KnowledgeStore([]);
      expect(emptyStore.getFormattedIndex()).toContain('No knowledge base documents are available');
    });
  });

  describe('loadByIds', () => {
    it('loads specific docs by ID', () => {
      const docs = store.loadByIds(['org-1', 'seg-2']);
      expect(docs).toHaveLength(2);
      expect(docs[0].id).toBe('org-1');
      expect(docs[1].id).toBe('seg-2');
    });

    it('marks loaded docs as loaded', () => {
      expect(store.isLoaded('org-1')).toBe(false);
      store.loadByIds(['org-1']);
      expect(store.isLoaded('org-1')).toBe(true);
    });

    it('skips unknown IDs', () => {
      const docs = store.loadByIds(['org-1', 'nonexistent']);
      expect(docs).toHaveLength(1);
    });

    it('returns empty for empty input', () => {
      expect(store.loadByIds([])).toEqual([]);
    });
  });

  describe('loadByTags', () => {
    it('loads docs matching any of the given tags (OR logic)', () => {
      const docs = store.loadByTags(['api-docs', 'threat-patterns']);
      expect(docs).toHaveLength(2);
      const ids = docs.map((d) => d.id);
      expect(ids).toContain('org-1');
      expect(ids).toContain('org-2');
    });

    it('returns empty for empty tags', () => {
      expect(store.loadByTags([])).toEqual([]);
    });

    it('marks matched docs as loaded', () => {
      store.loadByTags(['api-docs']);
      expect(store.isLoaded('org-1')).toBe(true);
      expect(store.isLoaded('org-2')).toBe(false);
    });

    it('filters by scope when specified', () => {
      const docs = store.loadByTags(['local-baselines'], 'application');
      expect(docs).toHaveLength(2);
      expect(docs.every((d) => d.scope_type === 'application')).toBe(true);
    });

    it('returns docs from both scopes when scope not specified', () => {
      const docs = store.loadByTags(['local-baselines']);
      expect(docs).toHaveLength(2); // seg-1 and seg-3
    });

    it('matches on any tag in the document', () => {
      const docs = store.loadByTags(['patterns']);
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('org-3'); // false-positives doc also has 'patterns' tag
    });

    it('matches on category name as a tag', () => {
      const docs = store.loadByTags(['system_docs']);
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('org-4'); // has category: 'system_docs'
    });

    it('matches both tags and categories in one call', () => {
      const docs = store.loadByTags(['api-docs', 'team']);
      expect(docs).toHaveLength(3); // org-1 (tag match) + seg-1, seg-2 (category match)
      const ids = docs.map((d) => d.id);
      expect(ids).toContain('org-1');
      expect(ids).toContain('seg-1');
      expect(ids).toContain('seg-2');
    });
  });

  describe('loadByCategory', () => {
    it('loads docs matching any of the given categories', () => {
      const docs = store.loadByCategory(['system_docs']);
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('org-4');
    });

    it('loads docs from multiple categories', () => {
      const docs = store.loadByCategory(['system_docs', 'team']);
      expect(docs).toHaveLength(3); // org-4 + seg-1 + seg-2
      const ids = docs.map((d) => d.id);
      expect(ids).toContain('org-4');
      expect(ids).toContain('seg-1');
      expect(ids).toContain('seg-2');
    });

    it('returns empty for empty categories', () => {
      expect(store.loadByCategory([])).toEqual([]);
    });

    it('marks matched docs as loaded', () => {
      store.loadByCategory(['system_docs']);
      expect(store.isLoaded('org-4')).toBe(true);
      expect(store.isLoaded('org-1')).toBe(false);
    });

    it('filters by scope when specified', () => {
      const docs = store.loadByCategory(['team'], 'application');
      expect(docs).toHaveLength(2);
      expect(docs.every((d) => d.scope_type === 'application')).toBe(true);
    });

    it('returns docs from both scopes when scope not specified', () => {
      // methodology is the default category for appDocs (5 of 6 app docs)
      const docs = store.loadByCategory(['methodology']);
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.every((d) => d.category === 'methodology')).toBe(true);
    });
  });

  describe('loadBySearch', () => {
    it('finds docs by title (case-insensitive)', () => {
      const docs = store.loadBySearch('api');
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('org-1');
    });

    it('finds partial matches', () => {
      const docs = store.loadBySearch('threat');
      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe('Threat Patterns');
    });

    it('returns empty for empty query', () => {
      expect(store.loadBySearch('')).toEqual([]);
    });

    it('matches category names', () => {
      const docs = store.loadBySearch('system_docs');
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('org-4');
    });

    it('matches partial category names', () => {
      const docs = store.loadBySearch('tea');
      expect(docs).toHaveLength(2); // seg-1 and seg-2 have category team
    });

    it('marks found docs as loaded', () => {
      store.loadBySearch('zones');
      expect(store.isLoaded('seg-1')).toBe(true);
    });
  });

  describe('loadForSkill', () => {
    it('loads by tags from skill deps', () => {
      const docs = store.loadForSkill({
        tags: ['threat-patterns', 'false-positives'],
      });
      expect(docs).toHaveLength(2);
      const ids = docs.map((d) => d.id);
      expect(ids).toContain('org-2');
      expect(ids).toContain('org-3');
    });

    it('loads everything when scope is all and no tags', () => {
      const docs = store.loadForSkill({ scope: 'all' });
      expect(docs).toHaveLength(9);
    });

    it('returns empty when no tags and scope is not all', () => {
      const docs = store.loadForSkill({});
      expect(docs).toEqual([]);
    });

    it('respects scope filter with tags', () => {
      const docs = store.loadForSkill({
        tags: ['local-baselines'],
        scope: 'application',
      });
      expect(docs).toHaveLength(2);
      expect(docs.every((d) => d.scope_type === 'application')).toBe(true);
    });

    it('defaults scope to all when undefined', () => {
      const docs = store.loadForSkill({ tags: ['team-context'] });
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('seg-2');
    });
  });

  describe('loadAll', () => {
    it('loads all documents', () => {
      const docs = store.loadAll();
      expect(docs).toHaveLength(9);
    });

    it('marks everything as loaded', () => {
      store.loadAll();
      expect(store.isLoaded('org-1')).toBe(true);
      expect(store.isLoaded('seg-3')).toBe(true);
    });
  });

  describe('getLoadedDocuments', () => {
    it('returns empty initially', () => {
      expect(store.getLoadedDocuments()).toEqual([]);
    });

    it('returns only loaded docs', () => {
      store.loadByIds(['org-1', 'seg-1']);
      const loaded = store.getLoadedDocuments();
      expect(loaded).toHaveLength(2);
      const ids = loaded.map((d) => d.id);
      expect(ids).toContain('org-1');
      expect(ids).toContain('seg-1');
    });

    it('deduplicates across multiple load calls', () => {
      store.loadByIds(['org-1']);
      store.loadByTags(['api-docs']); // loads org-1 again
      const loaded = store.getLoadedDocuments();
      expect(loaded).toHaveLength(1);
    });
  });

  describe('getAllDocuments', () => {
    it('returns all documents regardless of loaded state', () => {
      expect(store.getAllDocuments()).toHaveLength(9);
    });
  });

  describe('getAppDocuments', () => {
    it('returns app docs', () => {
      expect(store.getAppDocuments()).toHaveLength(9);
    });
  });

  describe('isLoaded', () => {
    it('returns false for unloaded doc', () => {
      expect(store.isLoaded('org-1')).toBe(false);
    });

    it('returns true after loading', () => {
      store.loadByIds(['org-1']);
      expect(store.isLoaded('org-1')).toBe(true);
    });

    it('returns false for unknown ID', () => {
      expect(store.isLoaded('nonexistent')).toBe(false);
    });
  });
});
