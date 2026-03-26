/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedStore} from '../repo/store-types.js';

/**
 * Metadata stored alongside each document in a store.
 */
export interface StoreDocumentMeta {
  /** When the document was computed/written */
  computedAt: string;
  /** TTL in seconds (resolved at write time) */
  ttl?: number;
  /** Whether the document is past its TTL */
  stale: boolean;
  /** ID of the automation that produced this document */
  automationId?: string;
  /** ID of the skill that produced this document */
  skillId?: string;
  /** Model used for computation */
  modelUsed?: string;
  /** Token cost of computation */
  tokenCost?: number;
  /** Estimated cost in USD */
  estimatedCostUsd?: number;
  /** Duration of computation in ms */
  durationMs?: number;
  /** Reasoning trace (if store has trace: true) */
  trace?: string;
}

/**
 * A document stored in a store collection.
 */
export interface StoreDocument {
  /** Document key (resolved from key template) */
  key: string;
  /** Tenant that owns this document */
  tenantId: string;
  /** Store name this document belongs to */
  store: string;
  /** Version number (increments on each update) */
  version: number;
  /** The entity payload (validated against store schema) */
  payload: Record<string, unknown>;
  /** Document metadata */
  meta: StoreDocumentMeta;
}

/**
 * Result of a store put (upsert) operation.
 */
export interface StorePutResult {
  /** Whether the document was stored successfully */
  stored: boolean;
  /** The document key */
  key: string;
  /** The new version number */
  version: number;
  /** The previous version number (if updating) */
  previousVersion?: number;
  /** Error message if stored is false */
  error?: string;
}

/**
 * Options for listing documents from a store.
 */
export interface StoreListOptions {
  /** Filter by field values (equality match on payload fields) */
  filter?: Record<string, unknown>;
  /** Sort field. Prefix with "-" for descending (e.g., "-severity") */
  sort?: string;
  /** Maximum number of documents to return */
  limit?: number;
  /** Number of documents to skip */
  offset?: number;
  /** Whether to include stale (expired) documents */
  includeStale?: boolean;
}

/**
 * Result of a store list operation.
 */
export interface StoreListResult {
  /** The matching documents */
  documents: StoreDocument[];
  /** Total count of matching documents (before limit/offset) */
  total: number;
  /** Whether there are more documents beyond the current page */
  hasMore: boolean;
}

/**
 * Interface for store persistence backends.
 *
 * Implementations: PGLite (default), remote Postgres, MongoDB, etc.
 * The interface lives in core so BYODB backends only need to depend on core.
 */
export interface StoreBackend {
  /**
   * Initialize the backend — create tables, indexes, etc.
   * Called once at startup with the full list of store definitions.
   */
  initialize(stores: LoadedStore[]): Promise<void>;

  /**
   * Get a single document by key.
   * Returns null if the document doesn't exist.
   */
  get(tenantId: string, store: string, key: string): Promise<StoreDocument | null>;

  /**
   * Upsert a document. If it exists, increments version and optionally
   * saves the previous version to history.
   */
  put(
    tenantId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult>;

  /**
   * List documents from a store with optional filtering, sorting, and pagination.
   */
  list(
    tenantId: string,
    store: string,
    options?: StoreListOptions,
  ): Promise<StoreListResult>;

  /**
   * Delete a document by key.
   * Returns true if the document existed and was deleted.
   */
  delete(tenantId: string, store: string, key: string): Promise<boolean>;

  /**
   * Get version history for a document (most recent first).
   * Returns empty array if no history exists.
   */
  history(tenantId: string, store: string, key: string): Promise<StoreDocument[]>;

  /**
   * Delete all documents past their TTL.
   * Returns the number of documents purged.
   */
  purgeExpired(tenantId: string, store?: string): Promise<number>;

  /**
   * Shut down the backend (close connections, release resources).
   */
  close(): Promise<void>;
}
