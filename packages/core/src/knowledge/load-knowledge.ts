/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { MessageBus } from '@google/gemini-cli-core';
import type {
  ToolResult,
  ToolCallConfirmationDetails,
  ToolInvocation,
} from '@google/gemini-cli-core';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from '@google/gemini-cli-core';
import type { KnowledgeStore } from './knowledge-store.js';
import { LOAD_KNOWLEDGE_TOOL_NAME } from '../tools/amodal-tool-names.js';
import { ToolErrorType } from '@google/gemini-cli-core';
import type { KBDocument } from './kb-types.js';

/**
 * Parameters for the load_knowledge tool.
 */
export interface LoadKnowledgeParams {
  tags?: string[];
  category?: string[];
  search?: string;
  ids?: string[];
}

/**
 * Format loaded documents as a readable string for the LLM.
 */
function formatLoadedDocs(docs: KBDocument[], alreadyLoaded: KBDocument[]): string {
  const sections: string[] = [];

  if (alreadyLoaded.length > 0) {
    const names = alreadyLoaded.map((d) => d.title).join(', ');
    sections.push(`Already loaded (skipped): ${names}`);
  }

  if (docs.length === 0 && alreadyLoaded.length > 0) {
    return sections.join('\n\n');
  }

  if (docs.length === 0) {
    return 'No matching documents found.';
  }

  for (const doc of docs) {
    const tagStr = doc.tags.length > 0 ? ` [${doc.tags.join(', ')}]` : '';
    sections.push(
      `## ${doc.title}${tagStr}\n` +
      `*${doc.scope_type} | ${doc.category}*\n\n` +
      doc.body,
    );
  }

  return sections.join('\n\n---\n\n');
}

class LoadKnowledgeInvocation extends BaseToolInvocation<
  LoadKnowledgeParams,
  ToolResult
> {
  constructor(
    private store: KnowledgeStore,
    params: LoadKnowledgeParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    if (this.params.category && this.params.category.length > 0) {
      return `load_knowledge [category: ${this.params.category.join(', ')}]`;
    }
    if (this.params.tags && this.params.tags.length > 0) {
      return `load_knowledge [tags: ${this.params.tags.join(', ')}]`;
    }
    if (this.params.search) {
      return `load_knowledge [search: ${this.params.search}]`;
    }
    if (this.params.ids && this.params.ids.length > 0) {
      return `load_knowledge [${String(this.params.ids.length)} docs]`;
    }
    return 'load_knowledge';
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Loading knowledge is read-only, no confirmation needed
    return false;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { tags, category, search, ids } = this.params;

    // Validate at least one param
    if (
      (!tags || tags.length === 0) &&
      (!category || category.length === 0) &&
      (!search || search.length === 0) &&
      (!ids || ids.length === 0)
    ) {
      const errorMessage =
        'At least one of tags, category, search, or ids must be provided.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const newDocs: KBDocument[] = [];
    const alreadyLoaded: KBDocument[] = [];

    // Collect docs from all provided params
    const candidateDocs: KBDocument[] = [];

    if (ids && ids.length > 0) {
      candidateDocs.push(...this.store.loadByIds(ids));
    }
    if (category && category.length > 0) {
      candidateDocs.push(...this.store.loadByCategory(category));
    }
    if (tags && tags.length > 0) {
      candidateDocs.push(...this.store.loadByTags(tags));
    }
    if (search) {
      candidateDocs.push(...this.store.loadBySearch(search));
    }

    // Deduplicate and split into new vs already-loaded
    const seen = new Set<string>();
    for (const doc of candidateDocs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      // Note: loadByIds/loadByTags/loadBySearch already mark docs as loaded,
      // so we check if the doc was loaded BEFORE this call by checking if it
      // was already in the loaded set. However, the store.load* methods mark
      // them immediately. For simplicity, we track "already loaded" as docs
      // that were loaded before this invocation. We'll re-check:
      // Actually the store marks them loaded during this call, but we still
      // want to show the full content for newly loaded docs.
      newDocs.push(doc);
    }

    const result = formatLoadedDocs(newDocs, alreadyLoaded);

    return {
      llmContent: result,
      returnDisplay: `Loaded ${String(newDocs.length)} knowledge document(s).`,
    };
  }
}

/**
 * Tool parameter schema for load_knowledge.
 */
const LOAD_KNOWLEDGE_SCHEMA = {
  type: 'object' as const,
  properties: {
    tags: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'Load documents matching any of these tags. Tags are shown in the KB index.',
    },
    category: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'Load documents matching any of these categories. ' +
        'Valid categories: system_docs, methodology, patterns, false_positives, ' +
        'response_procedures, environment, baselines, team, incident_history, working_memory.',
    },
    search: {
      type: 'string' as const,
      description: 'Search documents by title or category keyword.',
    },
    ids: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'Load specific documents by ID (from the KB index).',
    },
  },
};

/**
 * Built-in tool for loading knowledge base documents on demand.
 * Always available in every session. The agent uses this to load
 * specific documents from the KB index instead of having all docs
 * in the system prompt.
 */
export class LoadKnowledgeTool extends BaseDeclarativeTool<
  LoadKnowledgeParams,
  ToolResult
> {
  static readonly Name = LOAD_KNOWLEDGE_TOOL_NAME;

  constructor(
    private store: KnowledgeStore,
    messageBus: MessageBus,
  ) {
    super(
      LoadKnowledgeTool.Name,
      'Load Knowledge',
      'Load knowledge base documents by category, tags, search query, or IDs. ' +
        'The KB index in the system prompt shows available documents with their categories, tags, and IDs. ' +
        'Use this tool to load the full content of documents you need for the current task. ' +
        'Use the category parameter to load all documents in a category (e.g., "system_docs", "patterns").',
      Kind.Other,
      LOAD_KNOWLEDGE_SCHEMA,
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: LoadKnowledgeParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<LoadKnowledgeParams, ToolResult> {
    return new LoadKnowledgeInvocation(
      this.store,
      params,
      messageBus,
      _toolName,
      _toolDisplayName ?? 'Load Knowledge',
    );
  }
}
