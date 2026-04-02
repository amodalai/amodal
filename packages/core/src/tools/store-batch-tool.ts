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
import { storeToToolName, storeToJsonSchema } from '../repo/store-tool-schema.js';

function resolveKey(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const value = payload[field];
    if (value === undefined || value === null) {
      throw new Error(`Missing required field "${field}" for key template "${template}"`);
    }
    return String(value);
  });
}

interface StoreBatchParams {
  items: Array<Record<string, unknown>>;
}

class StoreBatchInvocation extends BaseToolInvocation<StoreBatchParams, ToolResult> {
  constructor(
    params: StoreBatchParams,
    messageBus: MessageBus,
    private readonly store: LoadedStore,
    private readonly backend: StoreBackend,
    private readonly appId: string,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Batch store ${String(this.params.items?.length ?? 0)} ${this.store.entity.name}(s) to ${this.store.name}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const items = this.params.items;
    if (!Array.isArray(items) || items.length === 0) {
      return {
        llmContent: 'Error: items array is required and must not be empty',
        returnDisplay: 'Error: no items provided',
        error: { message: 'items array is required', type: ToolErrorType.INVALID_TOOL_PARAMS },
      };
    }

    let stored = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        const key = resolveKey(this.store.entity.key, item);
        await this.backend.put(this.appId, this.store.name, key, item, {});
        stored++;
      } catch (err) {
        failed++;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const summary = `Stored ${String(stored)}/${String(items.length)} ${this.store.entity.name}(s)${failed > 0 ? `, ${String(failed)} failed` : ''}`;
    const output = JSON.stringify({ stored, failed, total: items.length, errors: errors.length > 0 ? errors.slice(0, 3) : undefined });

    return {
      llmContent: output,
      returnDisplay: summary,
    };
  }
}

/**
 * Batch write tool for storing multiple documents at once.
 * Auto-generated alongside the single-write StoreWriteTool.
 */
export class StoreBatchTool extends BaseDeclarativeTool<StoreBatchParams, ToolResult> {
  constructor(
    private readonly store: LoadedStore,
    private readonly backend: StoreBackend,
    private readonly appId: string,
    messageBus: MessageBus,
  ) {
    const entitySchema = storeToJsonSchema(store);
    super(
      `${storeToToolName(store.name)}_batch`,
      `Batch store ${store.entity.name}`,
      `Store multiple ${store.entity.name}(s) to the ${store.name} collection in one call. More efficient than calling ${storeToToolName(store.name)} repeatedly.`,
      Kind.Execute,
      {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: entitySchema,
            description: `Array of ${store.entity.name} objects to store`,
          },
        },
        required: ['items'],
      },
      messageBus,
      false,
      false,
    );
  }

  protected createInvocation(
    params: StoreBatchParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<StoreBatchParams, ToolResult> {
    return new StoreBatchInvocation(
      params,
      messageBus,
      this.store,
      this.backend,
      this.appId,
      _toolName,
      _toolDisplayName,
    );
  }
}
