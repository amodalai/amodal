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
 *
 * All writes are serialized through a queue to prevent concurrent access
 * issues with PGLite's single-threaded WASM engine.
 */
export class PGLiteStoreBackend implements StoreBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private readonly dataDir: string | undefined;
  private stores = new Map<string, LoadedStore>();
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }

  /**
   * Serialize a write operation through the queue.
   * Ensures PGLite only processes one write at a time.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(fn, fn);
    this.writeQueue = task.then(() => {}, () => {});
    return task;
  }

  async initialize(stores: LoadedStore[]): Promise<void> {
    if (this.dataDir) {
      const {mkdirSync} = await import('node:fs');
      mkdirSync(this.dataDir, {recursive: true});
    }

    const {PGlite} = await import('@electric-sql/pglite');
    this.db = new PGlite(this.dataDir ?? undefined);

    for (const store of stores) {
      this.stores.set(store.name, store);
    }

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_documents (
        app_id TEXT NOT NULL,
        store TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        meta JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (app_id, store, key)
      );

      CREATE INDEX IF NOT EXISTS idx_store_documents_store
        ON store_documents (app_id, store);

      CREATE INDEX IF NOT EXISTS idx_store_documents_expires
        ON store_documents (expires_at)
        WHERE expires_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS store_document_versions (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        store TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload JSONB NOT NULL,
        meta JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_store_versions_lookup
        ON store_document_versions (app_id, store, key, version DESC);
    `);
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new Error('PGLite store backend is not initialized or was closed');
    }
  }

  async get(appId: string, store: string, key: string): Promise<StoreDocument | null> {
    this.ensureDb();
    try {
      const result = await this.db.query(
        `SELECT key, app_id, store, version, payload, meta, expires_at
         FROM store_documents
         WHERE app_id = $1 AND store = $2 AND key = $3`,
        [appId, store, key],
      );

      if (result.rows.length === 0) return null;
      return this.rowToDocument(result.rows[0]);
    } catch (err) {
      process.stderr.write(`[store] get error: ${err instanceof Error ? err.message : String(err)}\n`);
      return null;
    }
  }

  async put(
    appId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult> {
    this.ensureDb();
    return this.enqueue(async () => {
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

      try {
        // Use upsert to avoid read-then-write race
        const existing = await this.db.query(
          `SELECT version, payload, meta FROM store_documents
           WHERE app_id = $1 AND store = $2 AND key = $3`,
          [appId, store, key],
        );

        if (existing.rows.length > 0) {
          const oldVersion = Number(existing.rows[0].version);
          const newVersion = oldVersion + 1;

          if (maxVersions && maxVersions > 0) {
            await this.db.query(
              `INSERT INTO store_document_versions (app_id, store, key, version, payload, meta)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [appId, store, key, oldVersion, JSON.stringify(existing.rows[0].payload), JSON.stringify(existing.rows[0].meta)],
            );

            await this.db.query(
              `DELETE FROM store_document_versions
               WHERE app_id = $1 AND store = $2 AND key = $3
                 AND version <= (
                   SELECT COALESCE(MAX(version), 0) - $4
                   FROM store_document_versions
                   WHERE app_id = $1 AND store = $2 AND key = $3
                 )`,
              [appId, store, key, maxVersions],
            );
          }

          await this.db.query(
            `UPDATE store_documents
             SET version = $4, payload = $5, meta = $6, expires_at = $7, updated_at = NOW()
             WHERE app_id = $1 AND store = $2 AND key = $3`,
            [appId, store, key, newVersion, JSON.stringify(payload), JSON.stringify(fullMeta), expiresAt],
          );

          return {stored: true, key, version: newVersion, previousVersion: oldVersion};
        }

        await this.db.query(
          `INSERT INTO store_documents (app_id, store, key, version, payload, meta, expires_at)
           VALUES ($1, $2, $3, 1, $4, $5, $6)`,
          [appId, store, key, JSON.stringify(payload), JSON.stringify(fullMeta), expiresAt],
        );

        return {stored: true, key, version: 1};
      } catch (err) {
        process.stderr.write(`[store] put error (${store}/${key}): ${err instanceof Error ? err.message : String(err)}\n`);
        return {stored: false, key, version: 0};
      }
    });
  }

  async list(
    appId: string,
    store: string,
    options: StoreListOptions = {},
  ): Promise<StoreListResult> {
    this.ensureDb();
    const {filter, sort, limit = 100, offset = 0, includeStale = false} = options;

    try {
      let where = 'WHERE app_id = $1 AND store = $2';
      const params: unknown[] = [appId, store];
      let paramIndex = 3;

      if (!includeStale) {
        where += ` AND (expires_at IS NULL OR expires_at > NOW())`;
      }

      if (filter) {
        for (const [field, value] of Object.entries(filter)) {
          where += ` AND payload->>'${field}' = $${paramIndex}`;
          params.push(String(value));
          paramIndex++;
        }
      }

      const countResult = await this.db.query(
        `SELECT COUNT(*)::int AS total FROM store_documents ${where}`,
        params,
      );
      const total = Number(countResult.rows[0].total);

      let orderBy = 'ORDER BY updated_at DESC';
      if (sort) {
        const desc = sort.startsWith('-');
        const field = desc ? sort.slice(1) : sort;
        const dir = desc ? 'DESC' : 'ASC';
        orderBy = `ORDER BY payload->>'${field}' ${dir}`;
      }

      const result = await this.db.query(
        `SELECT key, app_id, store, version, payload, meta, expires_at
         FROM store_documents ${where} ${orderBy}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset],
      );

      const documents = result.rows.map((row: Record<string, unknown>) => this.rowToDocument(row));

      return {documents, total, hasMore: offset + documents.length < total};
    } catch (err) {
      process.stderr.write(`[store] list error (${store}): ${err instanceof Error ? err.message : String(err)}\n`);
      return {documents: [], total: 0, hasMore: false};
    }
  }

  async delete(appId: string, store: string, key: string): Promise<boolean> {
    this.ensureDb();
    return this.enqueue(async () => {
      try {
        await this.db.query(
          `DELETE FROM store_document_versions WHERE app_id = $1 AND store = $2 AND key = $3`,
          [appId, store, key],
        );

        const result = await this.db.query(
          `DELETE FROM store_documents WHERE app_id = $1 AND store = $2 AND key = $3`,
          [appId, store, key],
        );

        return (result.affectedRows ?? 0) > 0;
      } catch (err) {
        process.stderr.write(`[store] delete error (${store}/${key}): ${err instanceof Error ? err.message : String(err)}\n`);
        return false;
      }
    });
  }

  async history(appId: string, store: string, key: string): Promise<StoreDocument[]> {
    this.ensureDb();
    try {
      const result = await this.db.query(
        `SELECT key, $1::text AS app_id, store, version, payload, meta
         FROM store_document_versions
         WHERE app_id = $1 AND store = $2 AND key = $3
         ORDER BY version DESC`,
        [appId, store, key],
      );

      return result.rows.map((row: Record<string, unknown>) => ({
        key: String(row['key']),
        appId: String(row['app_id']),
        store: String(row['store']),
        version: Number(row['version']),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        payload: (typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : row['payload']) as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        meta: (typeof row['meta'] === 'string' ? JSON.parse(row['meta']) : row['meta']) as StoreDocumentMeta,
      }));
    } catch (err) {
      process.stderr.write(`[store] history error (${store}/${key}): ${err instanceof Error ? err.message : String(err)}\n`);
      return [];
    }
  }

  async purgeExpired(appId: string, store?: string): Promise<number> {
    this.ensureDb();
    return this.enqueue(async () => {
      try {
        let query = `DELETE FROM store_documents WHERE app_id = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()`;
        const params: unknown[] = [appId];

        if (store) {
          query += ` AND store = $2`;
          params.push(store);
        }

        const result = await this.db.query(query, params);
        return result.affectedRows ?? 0;
      } catch (err) {
        process.stderr.write(`[store] purgeExpired error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 0;
      }
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch { /* best effort */ }
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
      appId: String(row['app_id']),
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
 */
export async function createPGLiteStoreBackend(
  stores: LoadedStore[],
  dataDir?: string,
): Promise<PGLiteStoreBackend> {
  const backend = new PGLiteStoreBackend(dataDir);
  await backend.initialize(stores);
  return backend;
}
