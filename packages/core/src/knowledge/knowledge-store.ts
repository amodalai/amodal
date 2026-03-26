/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  KBDocument,
  ScopeType,
  SkillKnowledgeDeps,
} from './kb-types.js';
import type { KBIndexEntry } from './kb-index.js';
import { buildKnowledgeIndex, formatKnowledgeIndex } from './kb-index.js';

/**
 * In-session knowledge base state. Holds all docs locally, tracks which
 * are loaded into context, and provides load-by-tags / search / IDs
 * methods. All docs are available from init; "loading" marks docs as
 * actively included in the conversation context.
 */
export class KnowledgeStore {
  private readonly appDocs: KBDocument[];
  private readonly tenantDocs: KBDocument[];
  private readonly allDocsById: Map<string, KBDocument>;
  private readonly loadedIds: Set<string> = new Set();

  constructor(appDocs: KBDocument[], tenantDocs: KBDocument[]) {
    this.appDocs = appDocs;
    this.tenantDocs = tenantDocs;
    this.allDocsById = new Map<string, KBDocument>();
    for (const doc of [...appDocs, ...tenantDocs]) {
      this.allDocsById.set(doc.id, doc);
    }
  }

  /** All index entries (compact, no body). */
  getIndex(): KBIndexEntry[] {
    return buildKnowledgeIndex([...this.appDocs, ...this.tenantDocs]);
  }

  /** Formatted KB index suitable for the system prompt. */
  getFormattedIndex(): string {
    return formatKnowledgeIndex(this.appDocs, this.tenantDocs);
  }

  /** Load specific documents by ID. Marks them as loaded. */
  loadByIds(ids: string[]): KBDocument[] {
    const results: KBDocument[] = [];
    for (const id of ids) {
      const doc = this.allDocsById.get(id);
      if (doc) {
        this.loadedIds.add(id);
        results.push(doc);
      }
    }
    return results;
  }

  /**
   * Load documents that match ANY of the given tags (OR logic).
   * Also matches against document categories, so passing a category
   * name like "system_docs" will find docs in that category even if
   * they have no explicit tags.
   * Optionally filter by scope type.
   */
  loadByTags(tags: string[], scope?: ScopeType): KBDocument[] {
    if (tags.length === 0) return [];
    const tagSet = new Set(tags);
    const docs = this.getDocsForScope(scope);
    const matched = docs.filter((d) =>
      d.tags.some((t) => tagSet.has(t)) || tagSet.has(d.category),
    );
    for (const doc of matched) {
      this.loadedIds.add(doc.id);
    }
    return matched;
  }

  /**
   * Load documents matching any of the given categories.
   * Optionally filter by scope type.
   */
  loadByCategory(categories: string[], scope?: ScopeType): KBDocument[] {
    if (categories.length === 0) return [];
    const catSet = new Set(categories);
    const docs = this.getDocsForScope(scope);
    const matched = docs.filter((d) => catSet.has(d.category));
    for (const doc of matched) {
      this.loadedIds.add(doc.id);
    }
    return matched;
  }

  /** Load documents whose title or category contains the search query (case-insensitive). */
  loadBySearch(query: string): KBDocument[] {
    if (!query) return [];
    const lower = query.toLowerCase();
    const matched = [...this.allDocsById.values()].filter((d) =>
      d.title.toLowerCase().includes(lower) ||
      d.category.toLowerCase().includes(lower),
    );
    for (const doc of matched) {
      this.loadedIds.add(doc.id);
    }
    return matched;
  }

  /** Load documents required by a skill's knowledge deps. */
  loadForSkill(deps: SkillKnowledgeDeps): KBDocument[] {
    const scope = deps.scope === 'all' || deps.scope === undefined
      ? undefined
      : deps.scope;

    // If no tags specified and scope is 'all', load everything
    if (!deps.tags || deps.tags.length === 0) {
      if (deps.scope === 'all') {
        return this.loadAll();
      }
      return [];
    }

    return this.loadByTags(deps.tags, scope);
  }

  /** Load ALL documents (marks everything as loaded). */
  loadAll(): KBDocument[] {
    const all = [...this.allDocsById.values()];
    for (const doc of all) {
      this.loadedIds.add(doc.id);
    }
    return all;
  }

  /** Get all documents that have been loaded into context. */
  getLoadedDocuments(): KBDocument[] {
    return [...this.allDocsById.values()].filter((d) =>
      this.loadedIds.has(d.id),
    );
  }

  /** Get all documents (loaded or not). */
  getAllDocuments(): KBDocument[] {
    return [...this.allDocsById.values()];
  }

  /** Get application-level documents. */
  getAppDocuments(): KBDocument[] {
    return this.appDocs;
  }

  /** Get tenant-level documents. */
  getTenantDocuments(): KBDocument[] {
    return this.tenantDocs;
  }

  /** Check whether a specific document has been loaded. */
  isLoaded(id: string): boolean {
    return this.loadedIds.has(id);
  }

  private getDocsForScope(scope?: ScopeType): KBDocument[] {
    if (scope === 'application') return this.appDocs;
    if (scope === 'tenant') return this.tenantDocs;
    return [...this.appDocs, ...this.tenantDocs];
  }
}
