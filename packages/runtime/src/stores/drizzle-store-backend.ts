/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle-ORM StoreBackend implementation.
 *
 * One query layer used by both PGLiteStoreBackend (local dev, in-process
 * WASM Postgres) and PostgresStoreBackend (hosted runtime, real Postgres).
 * Each concrete factory constructs the underlying db client and passes it
 * here along with an `onClose` callback for teardown.
 *
 * Errors bubble up as StoreError — callers at module edges (routes,
 * tool-context factory) are responsible for handling.
 */

import {sql, and, eq, lte, gt, isNull, or, desc, asc, count} from 'drizzle-orm';
import type {PgDatabase, PgQueryResultHKT} from 'drizzle-orm/pg-core';
import type {LoadedStore} from '@amodalai/core';
import type {
  StoreBackend,
  StoreDocument,
  StoreDocumentMeta,
  StorePutResult,
  StoreListOptions,
  StoreListResult,
} from '@amodalai/types';

import {storeDocuments, storeDocumentVersions} from './schema.js';
import {resolveTtl} from './ttl-resolver.js';
import {StoreError} from '../errors.js';
import type {Logger} from '../logger.js';

// Valid JSONB field identifier — alphanumerics and underscore only, must
// start with a letter or underscore. Used to guard filter/sort fields
// before interpolating into raw SQL via Drizzle's sql`` tag.
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface DrizzleStoreBackendOptions {
  db: AnyPgDatabase;
  stores: LoadedStore[];
  logger: Logger;
  onClose: () => Promise<void>;
}

export class DrizzleStoreBackend implements StoreBackend {
  private readonly db: AnyPgDatabase;
  private readonly storeConfigs: Map<string, LoadedStore>;
  private readonly logger: Logger;
  private readonly onClose: () => Promise<void>;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(opts: DrizzleStoreBackendOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.onClose = opts.onClose;
    this.storeConfigs = new Map(opts.stores.map((s) => [s.name, s]));
  }

  /**
   * StoreBackend.initialize() — no-op on this class. The concrete
   * factory (createPGLiteStoreBackend / createPostgresStoreBackend)
   * creates the db client and runs DDL before constructing this
   * backend. Kept for interface compliance.
   */
  async initialize(_stores: LoadedStore[]): Promise<void> {
    // Intentionally empty — initialization happens in the factories.
  }

  /**
   * Serialize write operations through a queue so that PGLite's
   * single-threaded WASM engine never sees concurrent writes. Postgres
   * doesn't need this strictly, but the overhead is negligible and the
   * shared ordering semantics are valuable.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(fn, fn);
    this.writeQueue = task.then(() => {}, () => {});
    return task;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StoreError('Store backend is closed', {store: '(any)', operation: 'ensureOpen'});
    }
  }

  async get(appId: string, store: string, key: string): Promise<StoreDocument | null> {
    this.ensureOpen();
    try {
      const rows = await this.db
        .select()
        .from(storeDocuments)
        .where(
          and(
            eq(storeDocuments.appId, appId),
            eq(storeDocuments.store, store),
            eq(storeDocuments.key, key),
          ),
        )
        .limit(1);

      if (rows.length === 0) return null;
      return this.rowToDocument(rows[0]);
    } catch (err) {
      throw new StoreError('get failed', {store, operation: 'get', context: {appId, key}, cause: err});
    }
  }

  async put(
    appId: string,
    store: string,
    key: string,
    payload: Record<string, unknown>,
    meta: Partial<StoreDocumentMeta>,
  ): Promise<StorePutResult> {
    this.ensureOpen();
    return this.enqueue(async () => {
      const storeConfig = this.storeConfigs.get(store);
      const ttlSeconds = resolveTtl(storeConfig?.ttl, payload);
      const maxVersions = storeConfig?.history?.versions;

      const fullMeta: StoreDocumentMeta = {
        computedAt: new Date().toISOString(),
        stale: false,
        ...meta,
        ttl: ttlSeconds,
      };

      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

      try {
        const existing = await this.db
          .select({
            version: storeDocuments.version,
            payload: storeDocuments.payload,
            meta: storeDocuments.meta,
          })
          .from(storeDocuments)
          .where(
            and(
              eq(storeDocuments.appId, appId),
              eq(storeDocuments.store, store),
              eq(storeDocuments.key, key),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          const oldVersion = existing[0].version;
          const newVersion = oldVersion + 1;

          if (maxVersions && maxVersions > 0) {
            await this.db.insert(storeDocumentVersions).values({
              appId,
              store,
              key,
              version: oldVersion,
              payload: existing[0].payload,
              meta: existing[0].meta,
            });

            // Trim history: keep only the most recent maxVersions rows.
            await this.db.execute(sql`
              DELETE FROM ${storeDocumentVersions}
              WHERE ${storeDocumentVersions.appId} = ${appId}
                AND ${storeDocumentVersions.store} = ${store}
                AND ${storeDocumentVersions.key} = ${key}
                AND ${storeDocumentVersions.version} <= (
                  SELECT COALESCE(MAX(${storeDocumentVersions.version}), 0) - ${maxVersions}
                  FROM ${storeDocumentVersions}
                  WHERE ${storeDocumentVersions.appId} = ${appId}
                    AND ${storeDocumentVersions.store} = ${store}
                    AND ${storeDocumentVersions.key} = ${key}
                )
            `);
          }

          await this.db
            .update(storeDocuments)
            .set({
              version: newVersion,
              payload,
              meta: fullMeta,
              expiresAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(storeDocuments.appId, appId),
                eq(storeDocuments.store, store),
                eq(storeDocuments.key, key),
              ),
            );

          return {stored: true, key, version: newVersion, previousVersion: oldVersion};
        }

        await this.db.insert(storeDocuments).values({
          appId,
          store,
          key,
          version: 1,
          payload,
          meta: fullMeta,
          expiresAt,
        });

        return {stored: true, key, version: 1};
      } catch (err) {
        throw new StoreError('put failed', {store, operation: 'put', context: {appId, key}, cause: err});
      }
    });
  }

  async list(
    appId: string,
    store: string,
    options: StoreListOptions = {},
  ): Promise<StoreListResult> {
    this.ensureOpen();
    const {filter, sort, limit = 100, offset = 0, includeStale = false} = options;

    try {
      const conds = [eq(storeDocuments.appId, appId), eq(storeDocuments.store, store)];

      if (!includeStale) {
        const staleCond = or(isNull(storeDocuments.expiresAt), gt(storeDocuments.expiresAt, new Date()));
        if (staleCond) conds.push(staleCond);
      }

      if (filter) {
        for (const [field, value] of Object.entries(filter)) {
          if (!FIELD_NAME_RE.test(field)) {
            throw new StoreError(`Invalid store filter field name: ${field}`, {
              store,
              operation: 'list',
              context: {field},
            });
          }
          // `field` is regex-validated (safe to inline). `value` is bound as a parameter.
          conds.push(sql`${storeDocuments.payload}->>${sql.raw(`'${field}'`)} = ${String(value)}`);
        }
      }

      const whereClause = and(...conds);

      const totalRows = await this.db
        .select({total: count()})
        .from(storeDocuments)
        .where(whereClause);
      const total = Number(totalRows[0]?.total ?? 0);

      // If limit is 0, the caller only wants the count — skip the data fetch.
      if (limit === 0) {
        return {documents: [], total, hasMore: total > 0};
      }

      let orderExpr;
      if (sort) {
        const descOrder = sort.startsWith('-');
        const field = descOrder ? sort.slice(1) : sort;
        if (!FIELD_NAME_RE.test(field)) {
          throw new StoreError(`Invalid store sort field name: ${field}`, {
            store,
            operation: 'list',
            context: {sort},
          });
        }
        const fieldSql = sql`${storeDocuments.payload}->>${sql.raw(`'${field}'`)}`;
        orderExpr = descOrder ? desc(fieldSql) : asc(fieldSql);
      } else {
        orderExpr = desc(storeDocuments.updatedAt);
      }

      const rows = await this.db
        .select()
        .from(storeDocuments)
        .where(whereClause)
        .orderBy(orderExpr)
        .limit(limit)
        .offset(offset);

      const documents = rows.map((r) => this.rowToDocument(r));
      return {documents, total, hasMore: offset + documents.length < total};
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError('list failed', {store, operation: 'list', context: {appId}, cause: err});
    }
  }

  async delete(appId: string, store: string, key: string): Promise<boolean> {
    this.ensureOpen();
    return this.enqueue(async () => {
      try {
        await this.db
          .delete(storeDocumentVersions)
          .where(
            and(
              eq(storeDocumentVersions.appId, appId),
              eq(storeDocumentVersions.store, store),
              eq(storeDocumentVersions.key, key),
            ),
          );

        const deleted = await this.db
          .delete(storeDocuments)
          .where(
            and(
              eq(storeDocuments.appId, appId),
              eq(storeDocuments.store, store),
              eq(storeDocuments.key, key),
            ),
          )
          .returning({key: storeDocuments.key});

        return deleted.length > 0;
      } catch (err) {
        throw new StoreError('delete failed', {store, operation: 'delete', context: {appId, key}, cause: err});
      }
    });
  }

  async history(appId: string, store: string, key: string): Promise<StoreDocument[]> {
    this.ensureOpen();
    try {
      const rows = await this.db
        .select()
        .from(storeDocumentVersions)
        .where(
          and(
            eq(storeDocumentVersions.appId, appId),
            eq(storeDocumentVersions.store, store),
            eq(storeDocumentVersions.key, key),
          ),
        )
        .orderBy(desc(storeDocumentVersions.version));

      return rows.map((r) => ({
        key: r.key,
        appId: r.appId,
        store: r.store,
        version: r.version,
        payload: r.payload,
        meta: r.meta,
      }));
    } catch (err) {
      throw new StoreError('history failed', {store, operation: 'history', context: {appId, key}, cause: err});
    }
  }

  async purgeExpired(appId: string, store?: string): Promise<number> {
    this.ensureOpen();
    return this.enqueue(async () => {
      try {
        const conds = [
          eq(storeDocuments.appId, appId),
          sql`${storeDocuments.expiresAt} IS NOT NULL`,
          lte(storeDocuments.expiresAt, new Date()),
        ];
        if (store) conds.push(eq(storeDocuments.store, store));

        const deleted = await this.db
          .delete(storeDocuments)
          .where(and(...conds))
          .returning({key: storeDocuments.key});

        return deleted.length;
      } catch (err) {
        throw new StoreError('purgeExpired failed', {store: store ?? '(all)', operation: 'purgeExpired', context: {appId}, cause: err});
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Wait for any in-flight writes to settle before closing the db.
    await this.writeQueue.catch(() => {});
    await this.onClose();
    this.logger.debug('store_backend_closed', {});
  }

  private rowToDocument(row: typeof storeDocuments.$inferSelect): StoreDocument {
    const isStale = row.expiresAt ? row.expiresAt <= new Date() : false;
    const meta: StoreDocumentMeta = {...row.meta, stale: isStale};
    return {
      key: row.key,
      appId: row.appId,
      store: row.store,
      version: row.version,
      payload: row.payload,
      meta,
    };
  }
}
