/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Store field & entity definitions (from repo/store-types.ts)
// ---------------------------------------------------------------------------

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
  type: StoreFieldType;
  nullable?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  item?: StoreFieldDefinition;
  fields?: Record<string, StoreFieldDefinition>;
  store?: string;
}

/**
 * The entity definition within a store — name, key template, and schema.
 */
export interface StoreEntityDefinition {
  name: string;
  key: string;
  schema: Record<string, StoreFieldDefinition>;
}

/**
 * TTL configuration for a store.
 */
export type StoreTtlConfig = number | {
  default: number;
  override?: Array<{condition: string; ttl: number}>;
};

/**
 * Failure handling configuration for store writes.
 */
export interface StoreFailureConfig {
  mode: 'partial' | 'all-or-nothing' | 'skip';
  retries?: number;
  backoff?: 'exponential' | 'linear' | 'none';
  deadLetter?: boolean;
}

/**
 * History/versioning configuration for a store.
 */
export interface StoreHistoryConfig {
  versions: number;
}

/**
 * A fully loaded store definition, ready for use by the runtime.
 */
export interface LoadedStore {
  name: string;
  entity: StoreEntityDefinition;
  ttl?: StoreTtlConfig;
  failure?: StoreFailureConfig;
  history?: StoreHistoryConfig;
  trace?: boolean;
  location: string;
  /**
   * When true, this store is shared across all scope IDs (agent-level).
   * Reads use scopeId = '' (no isolation); writes are rejected with StoreError.
   */
  shared?: boolean;
}

// ---------------------------------------------------------------------------
// Store backend types (from stores/store-backend.ts)
// ---------------------------------------------------------------------------

/**
 * Metadata stored alongside each document in a store.
 */
export interface StoreDocumentMeta {
  computedAt: string;
  ttl?: number;
  stale: boolean;
  automationId?: string;
  skillId?: string;
  modelUsed?: string;
  tokenCost?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  trace?: string;
}

/**
 * A document stored in a store collection.
 */
export interface StoreDocument {
  key: string;
  appId: string;
  store: string;
  version: number;
  payload: Record<string, unknown>;
  meta: StoreDocumentMeta;
}

/**
 * Result of a store put (upsert) operation.
 */
export interface StorePutResult {
  stored: boolean;
  key: string;
  version: number;
  previousVersion?: number;
  error?: string;
}

/**
 * Options for listing documents from a store.
 */
export interface StoreListOptions {
  filter?: Record<string, unknown>;
  sort?: string;
  limit?: number;
  offset?: number;
  includeStale?: boolean;
}

/**
 * Result of a store list operation.
 */
export interface StoreListResult {
  documents: StoreDocument[];
  total: number;
  hasMore: boolean;
}

/**
 * Interface for store persistence backends.
 */
export interface StoreBackend {
  initialize(stores: LoadedStore[]): Promise<void>;
  get(appId: string, scopeId: string, store: string, key: string): Promise<StoreDocument | null>;
  put(
    appId: string,
    scopeId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult>;
  list(
    appId: string,
    scopeId: string,
    store: string,
    options?: StoreListOptions,
  ): Promise<StoreListResult>;
  delete(appId: string, scopeId: string, store: string, key: string): Promise<boolean>;
  history(appId: string, scopeId: string, store: string, key: string): Promise<StoreDocument[]>;
  purgeExpired(appId: string, scopeId: string, store?: string): Promise<number>;
  close(): Promise<void>;
}
