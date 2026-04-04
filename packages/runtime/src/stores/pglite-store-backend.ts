/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * PGLite-backed store backend.
 *
 * Uses in-process WASM Postgres via @electric-sql/pglite + Drizzle ORM.
 * Data is stored in a configurable directory (default: in-memory).
 *
 * This file is a thin factory over DrizzleStoreBackend — it constructs
 * the PGLite client, runs DDL, wraps it in drizzle(), and hands off all
 * query logic to the shared backend.
 */

import {drizzle} from 'drizzle-orm/pglite';
import type {LoadedStore} from '@amodalai/core';
import type {
  StoreBackend,
  StoreDocument,
  StoreDocumentMeta,
  StorePutResult,
  StoreListOptions,
  StoreListResult,
} from '@amodalai/types';

import {DrizzleStoreBackend} from './drizzle-store-backend.js';
import {StoreError} from '../errors.js';
import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';

const CREATE_TABLES_DDL = `
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
`;

/**
 * PGLite store backend. Delegates all query logic to DrizzleStoreBackend
 * once the underlying PGLite instance has been initialized.
 *
 * Constructor + initialize() pattern is preserved for backwards
 * compatibility with existing callers (and test suites that `new` then
 * call `initialize()`).
 */
export interface PGLiteStoreBackendOptions {
  dataDir?: string;
  logger?: Logger;
}

export class PGLiteStoreBackend implements StoreBackend {
  private readonly dataDir: string | undefined;
  private readonly logger: Logger;
  private inner: DrizzleStoreBackend | null = null;

  constructor(dataDirOrOpts?: string | PGLiteStoreBackendOptions) {
    const opts: PGLiteStoreBackendOptions =
      typeof dataDirOrOpts === 'string' || dataDirOrOpts === undefined
        ? {dataDir: dataDirOrOpts}
        : dataDirOrOpts;
    this.dataDir = opts.dataDir;
    this.logger = opts.logger ?? defaultLogger;
  }

  async initialize(stores: LoadedStore[]): Promise<void> {
    if (this.inner) return;

    if (this.dataDir) {
      const {mkdirSync} = await import('node:fs');
      mkdirSync(this.dataDir, {recursive: true});
    }

    const {PGlite} = await import('@electric-sql/pglite');
    const pglite = new PGlite(this.dataDir ?? undefined);
    await pglite.exec(CREATE_TABLES_DDL);

    const db = drizzle(pglite);
    this.inner = new DrizzleStoreBackend({
      db,
      stores,
      logger: this.logger,
      onClose: async () => {
        await pglite.close();
      },
    });
  }

  private ensure(): DrizzleStoreBackend {
    if (!this.inner) {
      throw new StoreError('PGLite store backend is not initialized or was closed', {
        store: '(uninitialized)',
        operation: 'ensure',
      });
    }
    return this.inner;
  }

  async get(appId: string, store: string, key: string): Promise<StoreDocument | null> {
    return this.ensure().get(appId, store, key);
  }

  async put(
    appId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult> {
    return this.ensure().put(appId, store, key, payload, meta);
  }

  async list(
    appId: string,
    store: string,
    options?: StoreListOptions,
  ): Promise<StoreListResult> {
    return this.ensure().list(appId, store, options);
  }

  async delete(appId: string, store: string, key: string): Promise<boolean> {
    return this.ensure().delete(appId, store, key);
  }

  async history(appId: string, store: string, key: string): Promise<StoreDocument[]> {
    return this.ensure().history(appId, store, key);
  }

  async purgeExpired(appId: string, store?: string): Promise<number> {
    return this.ensure().purgeExpired(appId, store);
  }

  async close(): Promise<void> {
    if (!this.inner) return;
    await this.inner.close();
    this.inner = null;
  }
}

/**
 * Create a PGLite store backend.
 */
export async function createPGLiteStoreBackend(
  stores: LoadedStore[],
  dataDirOrOpts?: string | PGLiteStoreBackendOptions,
): Promise<PGLiteStoreBackend> {
  const backend = new PGLiteStoreBackend(dataDirOrOpts);
  await backend.initialize(stores);
  return backend;
}
