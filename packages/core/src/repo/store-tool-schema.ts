/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {StoreFieldDefinition, LoadedStore} from './store-types.js';

/**
 * Convert a StoreFieldDefinition to a JSON Schema property.
 */
export function fieldToJsonSchema(field: StoreFieldDefinition): Record<string, unknown> {
  switch (field.type) {
    case 'string':
      return {type: 'string'};

    case 'number': {
      const schema: Record<string, unknown> = {type: 'number'};
      if (field.min !== undefined) schema['minimum'] = field.min;
      if (field.max !== undefined) schema['maximum'] = field.max;
      return schema;
    }

    case 'boolean':
      return {type: 'boolean'};

    case 'datetime':
      return {type: 'string', format: 'date-time'};

    case 'enum':
      return {type: 'string', enum: field.values ?? []};

    case 'array': {
      const items = field.item ? fieldToJsonSchema(field.item) : {type: 'string'};
      return {type: 'array', items};
    }

    case 'object': {
      if (!field.fields) {
        return {type: 'object'};
      }
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, subField] of Object.entries(field.fields)) {
        properties[name] = fieldToJsonSchema(subField);
        if (!subField.nullable) {
          required.push(name);
        }
      }
      const schema: Record<string, unknown> = {type: 'object', properties};
      if (required.length > 0) schema['required'] = required;
      return schema;
    }

    case 'ref':
      // Refs are stored as the key string of the referenced entity
      return {type: 'string'};

    default:
      return {type: 'string'};
  }
}

/**
 * Wrap a JSON Schema property to allow null if the field is nullable.
 */
function wrapNullable(
  schema: Record<string, unknown>,
  field: StoreFieldDefinition,
): Record<string, unknown> {
  if (!field.nullable) return schema;
  return {oneOf: [schema, {type: 'null'}]};
}

/**
 * Convert a LoadedStore into a JSON Schema suitable for an LLM tool's `parameters`.
 *
 * The resulting schema has `type: 'object'` with `properties` derived from the
 * entity schema, and `required` listing all non-nullable fields.
 */
export function storeToJsonSchema(store: LoadedStore): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(store.entity.schema)) {
    properties[name] = wrapNullable(fieldToJsonSchema(field), field);
    if (!field.nullable) {
      required.push(name);
    }
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) {
    schema['required'] = required;
  }
  return schema;
}

/**
 * Convert a store name (kebab-case) to a tool name for writes.
 *
 * Example: "active-alerts" → "store_active_alerts"
 */
export function storeToToolName(storeName: string): string {
  return `store_${storeName.replace(/-/g, '_')}`;
}

/**
 * Find a LoadedStore by its generated tool name.
 *
 * Returns undefined if no store matches.
 */
export function findStoreByToolName(
  stores: LoadedStore[],
  toolName: string,
): LoadedStore | undefined {
  return stores.find((s) => storeToToolName(s.name) === toolName);
}
