/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { MessageBus } from '@google/gemini-cli-core';
import type { ToolResult, ToolInvocation } from '@google/gemini-cli-core';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from '@google/gemini-cli-core';
import { ToolErrorType } from '@google/gemini-cli-core';
import type { LoadedStore } from '../repo/store-types.js';
import type { StoreBackend } from '../stores/store-backend.js';

export const QUERY_STORE_TOOL_NAME = 'query_store';

interface QueryStoreParams {
  store: string;
  key?: string;
  filter?: Record<string, unknown>;
  sort?: string;
  limit?: number;
}

class StoreQueryInvocation extends BaseToolInvocation<QueryStoreParams, ToolResult> {
  constructor(
    params: QueryStoreParams,
    messageBus: MessageBus,
    private readonly backend: StoreBackend,
    private readonly tenantId: string,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return this.params.key
      ? `Get ${this.params.store}[${this.params.key}]`
      : `Query ${this.params.store}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { store, key, filter, sort, limit } = this.params;

    try {
      if (key) {
        const doc = await this.backend.get(this.tenantId, store, key);
        if (!doc) {
          const output = JSON.stringify({ found: false, key });
          return { llmContent: output, returnDisplay: `Not found: ${store}[${key}]` };
        }
        const output = JSON.stringify({ found: true, ...doc });
        return { llmContent: output, returnDisplay: `Found: ${store}[${key}]` };
      }

      const result = await this.backend.list(this.tenantId, store, {
        filter,
        sort,
        limit: typeof limit === 'number' ? limit : 20,
      });
      const output = JSON.stringify(result);
      return { llmContent: output, returnDisplay: `Query ${store}: ${String(result.total)} result(s)` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: `Error querying ${store}`,
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }
  }
}

/**
 * Tool for reading documents from any store collection.
 * Supports single-doc lookup by key or list with filtering/sorting.
 */
export class StoreQueryTool extends BaseDeclarativeTool<QueryStoreParams, ToolResult> {
  constructor(
    stores: LoadedStore[],
    private readonly backend: StoreBackend,
    private readonly tenantId: string,
    messageBus: MessageBus,
  ) {
    super(
      QUERY_STORE_TOOL_NAME,
      'Query Store',
      'Query documents from a store collection. Use "key" for a single document or "filter" for a list.',
      Kind.Fetch,
      {
        type: 'object',
        properties: {
          store: {
            type: 'string',
            enum: stores.map((s) => s.name),
            description: 'The store to query',
          },
          key: { type: 'string', description: 'Get a specific document by key' },
          filter: { type: 'object', description: 'Filter by field values (equality match)' },
          sort: { type: 'string', description: 'Sort field, prefix with - for descending' },
          limit: { type: 'number', description: 'Max documents to return (default: 20)' },
        },
        required: ['store'],
      },
      messageBus,
      false,
      false,
    );
  }

  protected createInvocation(
    params: QueryStoreParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<QueryStoreParams, ToolResult> {
    return new StoreQueryInvocation(
      params,
      messageBus,
      this.backend,
      this.tenantId,
      _toolName,
      _toolDisplayName,
    );
  }
}
