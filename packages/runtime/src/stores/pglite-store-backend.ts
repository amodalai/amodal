/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedStore} from '@amodalai/core';
import type {
  StoreBackend,
  StoreDocument,
  StoreDocumentMeta,
  StorePutResult,
  StoreListOptions,
  StoreListResult,
} from '@amodalai/core';

import {resolveTtl} from './ttl-resolver.js';

/**
 * PGLite-backed store backend.
 *
 * Uses in-process WASM Postgres via @electric-sql/pglite.
 * Data is stored in a configurable directory (default: .amodal/store-data/).
 * Zero config — just works.
 */
export class PGLiteStoreBackend implements StoreBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private readonly dataDir: string | undefined;
  private stores = new Map<string, LoadedStore>();

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }

  async initialize(stores: LoadedStore[]): Promise<void> {
    // Ensure data directory exists
    if (this.dataDir) {
      const {mkdirSync} = await import('node:fs');
      mkdirSync(this.dataDir, {recursive: true});
    }

    const {PGlite} = await import('@electric-sql/pglite');
    this.db = new PGlite(this.dataDir ?? undefined);

    for (const store of stores) {
      this.stores.set(store.name, store);
    }

    // Create tables
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_documents (
        tenant_id TEXT NOT NULL,
        store TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        meta JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, store, key)
      );

      CREATE INDEX IF NOT EXISTS idx_store_documents_store
        ON store_documents (tenant_id, store);

      CREATE INDEX IF NOT EXISTS idx_store_documents_expires
        ON store_documents (expires_at)
        WHERE expires_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS store_document_versions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload JSONB NOT NULL,
        meta JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_store_versions_lookup
        ON store_document_versions (tenant_id, store, key, version DESC);
    `);
  }

  async get(tenantId: string, store: string, key: string): Promise<StoreDocument | null> {
    const result = await this.db.query(
      `SELECT key, tenant_id, store, version, payload, meta, expires_at
       FROM store_documents
       WHERE tenant_id = $1 AND store = $2 AND key = $3`,
      [tenantId, store, key],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return this.rowToDocument(row);
  }

  async put(
    tenantId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult> {
    const storeConfig = this.stores.get(store);
    const ttlSeconds = resolveTtl(storeConfig?.ttl, payload);
    const maxVersions = storeConfig?.history?.versions;

    const fullMeta: StoreDocumentMeta = {
      computedAt: new Date().toISOString(),
      stale: false,
      ...meta,
      ttl: ttlSeconds,
    };

    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    // Check for existing document
    const existing = await this.db.query(
      `SELECT version, payload, meta FROM store_documents
       WHERE tenant_id = $1 AND store = $2 AND key = $3`,
      [tenantId, store, key],
    );

    if (existing.rows.length > 0) {
      const oldVersion = Number(existing.rows[0].version);
      const newVersion = oldVersion + 1;

      // Save old version to history if configured
      if (maxVersions && maxVersions > 0) {
        await this.db.query(
          `INSERT INTO store_document_versions (tenant_id, store, key, version, payload, meta)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, store, key, oldVersion, JSON.stringify(existing.rows[0].payload), JSON.stringify(existing.rows[0].meta)],
        );

        // Prune old versions beyond the limit
        await this.db.query(
          `DELETE FROM store_document_versions
           WHERE tenant_id = $1 AND store = $2 AND key = $3
             AND version <= (
               SELECT COALESCE(MAX(version), 0) - $4
               FROM store_document_versions
               WHERE tenant_id = $1 AND store = $2 AND key = $3
             )`,
          [tenantId, store, key, maxVersions],
        );
      }

      // Update existing document
      await this.db.query(
        `UPDATE store_documents
         SET version = $4, payload = $5, meta = $6, expires_at = $7, updated_at = NOW()
         WHERE tenant_id = $1 AND store = $2 AND key = $3`,
        [tenantId, store, key, newVersion, JSON.stringify(payload), JSON.stringify(fullMeta), expiresAt],
      );

      return {stored: true, key, version: newVersion, previousVersion: oldVersion};
    }

    // Insert new document
    await this.db.query(
      `INSERT INTO store_documents (tenant_id, store, key, version, payload, meta, expires_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6)`,
      [tenantId, store, key, JSON.stringify(payload), JSON.stringify(fullMeta), expiresAt],
    );

    return {stored: true, key, version: 1};
  }

  async list(
    tenantId: string,
    store: string,
    options: StoreListOptions = {},
  ): Promise<StoreListResult> {
    const {filter, sort, limit = 100, offset = 0, includeStale = false} = options;

    let where = 'WHERE tenant_id = $1 AND store = $2';
    const params: unknown[] = [tenantId, store];
    let paramIndex = 3;

    // Exclude expired docs unless includeStale
    if (!includeStale) {
      where += ` AND (expires_at IS NULL OR expires_at > NOW())`;
    }

    // Apply filters
    if (filter) {
      for (const [field, value] of Object.entries(filter)) {
        where += ` AND payload->>'${field}' = $${paramIndex}`;
        params.push(String(value));
        paramIndex++;
      }
    }

    // Count total
    const countResult = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM store_documents ${where}`,
      params,
    );
    const total = Number(countResult.rows[0].total);

    // Build ORDER BY
    let orderBy = 'ORDER BY updated_at DESC';
    if (sort) {
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      const dir = desc ? 'DESC' : 'ASC';
      orderBy = `ORDER BY payload->>'${field}' ${dir}`;
    }

    // Fetch documents
    const result = await this.db.query(
      `SELECT key, tenant_id, store, version, payload, meta, expires_at
       FROM store_documents ${where} ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    );

    const documents = result.rows.map((row: Record<string, unknown>) => this.rowToDocument(row));

    return {
      documents,
      total,
      hasMore: offset + documents.length < total,
    };
  }

  async delete(tenantId: string, store: string, key: string): Promise<boolean> {
    // Delete history too
    await this.db.query(
      `DELETE FROM store_document_versions WHERE tenant_id = $1 AND store = $2 AND key = $3`,
      [tenantId, store, key],
    );

    const result = await this.db.query(
      `DELETE FROM store_documents WHERE tenant_id = $1 AND store = $2 AND key = $3`,
      [tenantId, store, key],
    );

    return (result.affectedRows ?? 0) > 0;
  }

  async history(tenantId: string, store: string, key: string): Promise<StoreDocument[]> {
    const result = await this.db.query(
      `SELECT key, $1::text AS tenant_id, store, version, payload, meta
       FROM store_document_versions
       WHERE tenant_id = $1 AND store = $2 AND key = $3
       ORDER BY version DESC`,
      [tenantId, store, key],
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      key: String(row['key']),
      tenantId: String(row['tenant_id']),
      store: String(row['store']),
      version: Number(row['version']),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      payload: (typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : row['payload']) as Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      meta: (typeof row['meta'] === 'string' ? JSON.parse(row['meta']) : row['meta']) as StoreDocumentMeta,
    }));
  }

  async purgeExpired(tenantId: string, store?: string): Promise<number> {
    let query = `DELETE FROM store_documents WHERE tenant_id = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()`;
    const params: unknown[] = [tenantId];

    if (store) {
      query += ` AND store = $2`;
      params.push(store);
    }

    const result = await this.db.query(query, params);
    return result.affectedRows ?? 0;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private rowToDocument(row: Record<string, unknown>): StoreDocument {
    const expiresAt = row['expires_at'];
    const isStale = expiresAt ? new Date(String(expiresAt)) <= new Date() : false;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const meta = (typeof row['meta'] === 'string' ? JSON.parse(row['meta']) : row['meta']) as StoreDocumentMeta;
    meta.stale = isStale;

    return {
      key: String(row['key']),
      tenantId: String(row['tenant_id']),
      store: String(row['store']),
      version: Number(row['version']),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      payload: (typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : row['payload']) as Record<string, unknown>,
      meta,
    };
  }
}

/**
 * Create a PGLite store backend.
 *
 * @param stores Store definitions for initialization
 * @param dataDir Optional PGLite data directory (default: in-memory)
 */
export async function createPGLiteStoreBackend(
  stores: LoadedStore[],
  dataDir?: string,
): Promise<PGLiteStoreBackend> {
  const backend = new PGLiteStoreBackend(dataDir);
  await backend.initialize(stores);
  return backend;
}
