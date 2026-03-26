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

/**
 * Resolve a key template (e.g., "{alert_id}") from payload values.
 */
function resolveKey(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const value = payload[field];
    if (value === undefined || value === null) {
      throw new Error(`Missing required field "${field}" for key template "${template}"`);
    }
    return String(value);
  });
}

interface StoreWriteParams {
  [key: string]: unknown;
}

class StoreWriteInvocation extends BaseToolInvocation<StoreWriteParams, ToolResult> {
  constructor(
    params: StoreWriteParams,
    messageBus: MessageBus,
    private readonly store: LoadedStore,
    private readonly backend: StoreBackend,
    private readonly tenantId: string,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Store a ${this.store.entity.name} to ${this.store.name}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    let key: string;
    try {
      key = resolveKey(this.store.entity.key, this.params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: `Error: ${message}`,
        error: { message, type: ToolErrorType.INVALID_TOOL_PARAMS },
      };
    }

    try {
      const result = await this.backend.put(
        this.tenantId,
        this.store.name,
        key,
        this.params,
        {},
      );
      const output = JSON.stringify(result);
      return {
        llmContent: output,
        returnDisplay: `Stored ${this.store.entity.name} with key "${key}" (v${String(result.version)})`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: `Error storing ${this.store.entity.name}`,
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }
  }
}

/**
 * Tool for writing a document to a specific store collection.
 * One instance per store definition. The LLM fills in the entity fields
 * and the tool resolves the key, validates, and persists.
 */
export class StoreWriteTool extends BaseDeclarativeTool<StoreWriteParams, ToolResult> {
  constructor(
    private readonly store: LoadedStore,
    private readonly backend: StoreBackend,
    private readonly tenantId: string,
    messageBus: MessageBus,
  ) {
    super(
      storeToToolName(store.name),
      `Store ${store.entity.name}`,
      `Store a ${store.entity.name} to the ${store.name} collection.`,
      Kind.Execute,
      storeToJsonSchema(store),
      messageBus,
      false,
      false,
    );
  }

  protected createInvocation(
    params: StoreWriteParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<StoreWriteParams, ToolResult> {
    return new StoreWriteInvocation(
      params,
      messageBus,
      this.store,
      this.backend,
      this.tenantId,
      _toolName,
      _toolDisplayName,
    );
  }
}
