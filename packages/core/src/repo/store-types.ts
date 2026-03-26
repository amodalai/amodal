/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Supported field types in a store entity schema.
 */
export type StoreFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'array'
  | 'object'
  | 'ref';

/**
 * A single field definition within a store entity schema.
 */
export interface StoreFieldDefinition {
  /** The field type */
  type: StoreFieldType;
  /** If true, the field may be null */
  nullable?: boolean;
  /** For enum fields — allowed values */
  values?: string[];
  /** For number fields — minimum value */
  min?: number;
  /** For number fields — maximum value */
  max?: number;
  /** For array fields — the element type */
  item?: StoreFieldDefinition;
  /** For object fields — nested field definitions */
  fields?: Record<string, StoreFieldDefinition>;
  /** For ref fields — the target store name */
  store?: string;
}

/**
 * The entity definition within a store — name, key template, and schema.
 */
export interface StoreEntityDefinition {
  /** TypeScript type name for the entity (e.g., "ClassifiedAlert") */
  name: string;
  /** Key template (e.g., "{event_id}" or "alert:{event_id}") */
  key: string;
  /** Field definitions for the entity */
  schema: Record<string, StoreFieldDefinition>;
}

/**
 * TTL configuration for a store. Either a simple number (seconds)
 * or a conditional config with overrides.
 */
export type StoreTtlConfig = number | {
  default: number;
  override?: Array<{condition: string; ttl: number}>;
};

/**
 * Failure handling configuration for store writes.
 */
export interface StoreFailureConfig {
  /** How to handle write failures */
  mode: 'partial' | 'all-or-nothing' | 'skip';
  /** Number of retries before giving up */
  retries?: number;
  /** Backoff strategy between retries */
  backoff?: 'exponential' | 'linear' | 'none';
  /** Whether to store failed writes in a dead-letter collection */
  deadLetter?: boolean;
}

/**
 * History/versioning configuration for a store.
 */
export interface StoreHistoryConfig {
  /** Number of previous versions to retain per document */
  versions: number;
}

/**
 * A fully loaded store definition, ready for use by the runtime.
 */
export interface LoadedStore {
  /** Store name (from filename or "name" field) — kebab-case */
  name: string;
  /** Entity definition: type name, key template, field schema */
  entity: StoreEntityDefinition;
  /** TTL configuration — seconds or conditional */
  ttl?: StoreTtlConfig;
  /** Failure handling configuration */
  failure?: StoreFailureConfig;
  /** Version history configuration */
  history?: StoreHistoryConfig;
  /** Whether to store reasoning traces alongside documents */
  trace?: boolean;
  /** Filesystem path to the store definition file */
  location: string;
}
