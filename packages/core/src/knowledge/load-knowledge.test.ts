/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadKnowledgeTool } from './load-knowledge.js';
import { KnowledgeStore } from './knowledge-store.js';
import type { KBDocument } from './kb-types.js';
import type { MessageBus } from '@google/gemini-cli-core';

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
  makeDoc({ id: 'org-3', title: 'False Positives', tags: ['false-positives'] }),
];

const extraDocs: KBDocument[] = [
  makeDoc({
    id: 'seg-1',
    title: 'Facility Zones',
    scope_type: 'application',
    scope_id: 'seg-acme',
    tags: ['zones'],
    category: 'team',
  }),
];

function createMockMessageBus(): MessageBus {
  return {
    waitForResponse: vi.fn(),
    sendConfirmationRequest: vi.fn(),
    sendNotification: vi.fn(),
    sendMessage: vi.fn(),
  } as unknown as MessageBus;
}

let store: KnowledgeStore;
let tool: LoadKnowledgeTool;
let messageBus: MessageBus;

beforeEach(() => {
  store = new KnowledgeStore([...appDocs, ...extraDocs]);
  messageBus = createMockMessageBus();
  tool = new LoadKnowledgeTool(store, messageBus);
});

describe('LoadKnowledgeTool', () => {
  it('has correct tool name', () => {
    expect(LoadKnowledgeTool.Name).toBe('load_knowledge');
  });

  describe('invoke by tags', () => {
    it('loads documents matching tags', async () => {
      const invocation = tool.build(
        { tags: ['api-docs'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('API Docs');
      expect(result.llmContent).toContain('Body of API Docs');
      expect(result.returnDisplay).toContain('1 knowledge document');
    });

    it('loads multiple docs from multiple tags', async () => {
      const invocation = tool.build(
        { tags: ['api-docs', 'threat-patterns'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('API Docs');
      expect(result.llmContent).toContain('Threat Patterns');
      expect(result.returnDisplay).toContain('2 knowledge document');
    });
  });

  describe('invoke by category', () => {
    it('loads documents matching category', async () => {
      const invocation = tool.build(
        { category: ['methodology'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('API Docs');
      expect(result.llmContent).toContain('Threat Patterns');
      expect(result.llmContent).toContain('False Positives');
      expect(result.returnDisplay).toContain('3 knowledge document');
    });

    it('loads documents from multiple categories', async () => {
      const invocation = tool.build(
        { category: ['methodology', 'team'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('API Docs');
      expect(result.llmContent).toContain('Facility Zones');
      expect(result.returnDisplay).toContain('4 knowledge document');
    });
  });

  describe('invoke by search', () => {
    it('loads documents matching search query', async () => {
      const invocation = tool.build(
        { search: 'threat' },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('Threat Patterns');
    });
  });

  describe('invoke by IDs', () => {
    it('loads specific documents by ID', async () => {
      const invocation = tool.build(
        { ids: ['org-1', 'seg-1'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('API Docs');
      expect(result.llmContent).toContain('Facility Zones');
      expect(result.returnDisplay).toContain('2 knowledge document');
    });
  });

  describe('validation', () => {
    it('returns error when no params provided', async () => {
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.llmContent).toContain('At least one of');
      expect(result.llmContent).toContain('category');
    });

    it('returns error for empty arrays', async () => {
      const invocation = tool.build(
        { tags: [], ids: [] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
    });
  });

  describe('no matches', () => {
    it('returns message when no docs match', async () => {
      const invocation = tool.build(
        { tags: ['nonexistent-tag'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('No matching documents found');
    });
  });

  describe('formatting', () => {
    it('includes scope and category in output', async () => {
      const invocation = tool.build(
        { ids: ['org-1'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('application | methodology');
    });

    it('includes tags in output', async () => {
      const invocation = tool.build(
        { ids: ['org-1'] },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('[api-docs, endpoints]');
    });
  });
});
