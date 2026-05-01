/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Store tools rewritten for the new ToolRegistry.
 *
 * These replace the BaseDeclarativeTool subclasses in core with Zod-based
 * ToolDefinition objects. Each function returns a ToolDefinition that can
 * be registered on the ToolRegistry.
 *
 * Three tools per store:
 * - store_{name}       — write a single document
 * - store_{name}_batch — write multiple documents
 * - query_store        — query/get documents from any store
 */

import {z} from 'zod';
import type {LoadedStore, StoreBackend, StoreFieldDefinition} from '@amodalai/types';
import {StoreError} from '../errors.js';
import type {ToolDefinition, ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a store name (kebab-case) to a tool name.
 * Example: "active-alerts" → "store_active_alerts"
 */
export function storeToToolName(storeName: string): string {
  return `store_${storeName.replace(/-/g, '_')}`;
}

/**
 * Resolve a key template (e.g., "{alert_id}") from payload values.
 */
function resolveKey(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const value = payload[field];
    if (value === undefined || value === null) {
      throw new StoreError(`Missing required field "${field}" for key template "${template}"`, {
        store: '',
        operation: 'resolve_key',
        context: {template, field},
      });
    }
    return String(value);
  });
}

/**
 * Build a Zod schema from a store's entity field definitions.
 */
function buildStoreZodSchema(store: LoadedStore): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(store.entity.schema)) {
    shape[name] = fieldToZod(field);
  }

  return z.object(shape).passthrough();
}

function fieldToZod(field: StoreFieldDefinition): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field.type) {
    case 'string':
      schema = z.string();
      break;
    case 'number': {
      let numSchema = z.number();
      if (field.min !== undefined) numSchema = numSchema.min(field.min);
      if (field.max !== undefined) numSchema = numSchema.max(field.max);
      schema = numSchema;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'datetime':
      schema = z.string();
      break;
    case 'enum':
      schema = field.values && field.values.length > 0
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by length > 0 check
        ? z.enum(field.values as [string, ...string[]])
        : z.string();
      break;
    case 'array':
      schema = z.array(field.item ? fieldToZod(field.item) : z.string());
      break;
    case 'object':
      if (field.fields) {
        const nested: Record<string, z.ZodTypeAny> = {};
        for (const [n, f] of Object.entries(field.fields)) {
          nested[n] = fieldToZod(f);
        }
        schema = z.object(nested);
      } else {
        schema = z.record(z.unknown());
      }
      break;
    case 'ref':
      schema = z.string();
      break;
    default:
      schema = z.unknown();
      break;
  }

  if (field.nullable) {
    schema = schema.nullable();
  }

  return schema;
}

// ---------------------------------------------------------------------------
// Store write tool
// ---------------------------------------------------------------------------

/**
 * Create a store write ToolDefinition for a single store.
 */
export function createStoreWriteTool(
  store: LoadedStore,
  backend: StoreBackend,
  appId: string,
): ToolDefinition {
  const entitySchema = buildStoreZodSchema(store);

  return {
    description: `Write a single ${store.entity.name} to the ${store.name} store. Creates or updates the document by key.`,
    parameters: entitySchema,
    readOnly: false,
    metadata: {category: 'store'},
    runningLabel: `Saving to ${store.name}`,
    completedLabel: `Saved to ${store.name}`,

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const key = resolveKey(store.entity.key, params);
      const result = await backend.put(appId, ctx.scopeId, store.name, key, params, {});
      return {stored: true, key, version: result.version};
    },
  };
}

// ---------------------------------------------------------------------------
// Store batch tool
// ---------------------------------------------------------------------------

/**
 * Create a store batch write ToolDefinition for a single store.
 */
export function createStoreBatchTool(
  store: LoadedStore,
  backend: StoreBackend,
  appId: string,
): ToolDefinition {
  const entitySchema = buildStoreZodSchema(store);

  return {
    description: `Write multiple ${store.entity.name}(s) to the ${store.name} store in one call. Each item is created or updated by key.`,
    parameters: z.object({
      items: z.array(entitySchema).min(1),
    }),
    readOnly: false,
    metadata: {category: 'store'},
    runningLabel: `Saving to ${store.name}`,
    completedLabel: `Saved to ${store.name}`,

    async execute(params: {items: Array<Record<string, unknown>>}, ctx: ToolContext): Promise<unknown> {
      let stored = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const item of params.items) {
        try {
          const key = resolveKey(store.entity.key, item);
          await backend.put(appId, ctx.scopeId, store.name, key, item, {});
          stored++;
        } catch (err) {
          failed++;
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      return {
        stored,
        failed,
        total: params.items.length,
        ...(errors.length > 0 ? {errors: errors.slice(0, 3)} : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Store query tool
// ---------------------------------------------------------------------------

export const QUERY_STORE_TOOL_NAME = 'query_store';

/**
 * Create a store query ToolDefinition that reads from any store.
 */
export function createStoreQueryTool(
  stores: LoadedStore[],
  backend: StoreBackend,
  appId: string,
): ToolDefinition {
  const storeNames = stores.map((s) => s.name);

  return {
    description: `Query documents from a data store. Use the "store" parameter to specify which store (${storeNames.join(', ')}). Pass "key" to fetch a single document by ID, or "filter" to search for documents matching field values. Returns the matching document(s) with all fields.`,
    parameters: z.object({
      store: (storeNames.length > 0
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by length > 0 check
        ? z.enum(storeNames as [string, ...string[]])
        : z.string()
      ).describe(`Name of the store to query (${storeNames.join(', ')})`),
      key: z.string().optional().describe('Fetch a single document by its key/ID'),
      filter: z.record(z.unknown()).optional().describe('Filter documents by field values, e.g. {"status": "active"}'),
      sort: z.string().optional().describe('Sort field name'),
      limit: z.number().optional().describe('Max number of documents to return'),
    }),
    readOnly: true,
    metadata: {category: 'store'},
    runningLabel: 'Looking up {{store}}',
    completedLabel: 'Looked up {{store}}',

    async execute(params: {store: string; key?: string; filter?: Record<string, unknown>; sort?: string; limit?: number}, ctx: ToolContext): Promise<unknown> {
      if (params.key) {
        const doc = await backend.get(appId, ctx.scopeId, params.store, params.key);
        if (!doc) {
          return {found: false, key: params.key};
        }
        return {found: true, ...doc};
      }

      const result = await backend.list(appId, ctx.scopeId, params.store, {
        filter: params.filter,
        sort: params.sort,
        limit: typeof params.limit === 'number' ? params.limit : 20,
      });
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Register all store tools
// ---------------------------------------------------------------------------

/**
 * Register store tools on a ToolRegistry for all stores in a bundle.
 */
export function registerStoreTools(
  registry: import('./types.js').ToolRegistry,
  stores: LoadedStore[],
  backend: StoreBackend,
  appId: string,
): void {
  for (const store of stores) {
    registry.register(storeToToolName(store.name), createStoreWriteTool(store, backend, appId));
    registry.register(`${storeToToolName(store.name)}_batch`, createStoreBatchTool(store, backend, appId));
  }

  if (stores.length > 0) {
    registry.register(QUERY_STORE_TOOL_NAME, createStoreQueryTool(stores, backend, appId));
  }
}
