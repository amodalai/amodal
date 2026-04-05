/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle-ORM SessionStore implementation.
 *
 * One query layer used by both the PGLite factory (local dev,
 * in-process WASM Postgres) and the Postgres factory (hosted runtime,
 * real Postgres). Each factory constructs the underlying db client,
 * runs DDL, and hands the result here along with a table binding and
 * an `onClose` callback for teardown.
 *
 * Mirrors the `DrizzleStoreBackend` pattern introduced in amodal#146.
 *
 * Errors bubble up as SessionStoreError — callers at module edges
 * (session manager, routes) are responsible for handling.
 */

import {and, eq, lt, desc} from 'drizzle-orm';
import type {PgDatabase, PgQueryResultHKT} from 'drizzle-orm/pg-core';

import {SessionStoreError} from '../errors.js';
import type {Logger} from '../logger.js';
import type {PersistedSession} from './types.js';
import type {agentSessions} from '../stores/schema.js';
import {
  buildListConditions,
  encodeCursor,
  rowToPersistedSession,
  sessionToRow,
} from './store.js';
import type {
  SessionListOptions,
  SessionListResult,
  SessionStore,
  SessionStoreHooks,
} from './store.js';

/**
 * Table binding type accepted by DrizzleSessionStore. Both backends'
 * table instances (static `agentSessions` for PGLite, dynamic
 * `makeAgentSessionsTable(name)` for Postgres) satisfy this — they
 * share the same column shape, only the SQL name differs.
 */
export type AgentSessionsTable = typeof agentSessions;

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const DEFAULT_LIST_LIMIT = 50;

export interface DrizzleSessionStoreOptions {
  /** Drizzle database instance (from either `drizzle-orm/pglite` or `drizzle-orm/node-postgres`). */
  db: AnyPgDatabase;
  /** Table binding — `agentSessions` (default name) or a dynamic table for custom names. */
  table: AgentSessionsTable;
  /** Backend name used in log + error context (e.g. 'pglite', 'postgres'). */
  backendName: string;
  /** Logger for structured events. */
  logger: Logger;
  /** Optional post-mutation hooks (dual-write, observability). */
  hooks?: SessionStoreHooks;
  /** Cleanup callback — the factory's way to tear down its pool / WASM instance. */
  onClose: () => Promise<void>;
}

export class DrizzleSessionStore implements SessionStore {
  private readonly db: AnyPgDatabase;
  private readonly table: AgentSessionsTable;
  readonly backendName: string;
  private readonly logger: Logger;
  private readonly hooks: SessionStoreHooks;
  private readonly onClose: () => Promise<void>;
  private closed = false;

  constructor(opts: DrizzleSessionStoreOptions) {
    this.db = opts.db;
    this.table = opts.table;
    this.backendName = opts.backendName;
    this.logger = opts.logger;
    this.hooks = opts.hooks ?? {};
    this.onClose = opts.onClose;
  }

  /**
   * `initialize()` on this class is a no-op — the factory does the
   * DDL and client setup before constructing the store. Kept for
   * interface compliance.
   */
  async initialize(): Promise<void> {
    // Intentionally empty — initialization happens in the factories.
  }

  async save(session: PersistedSession): Promise<void> {
    this.ensureOpen('save');
    const values = sessionToRow(session);

    try {
      await this.db
        .insert(this.table)
        .values(values)
        .onConflictDoUpdate({
          target: this.table.id,
          set: {
            messages: values.messages,
            tokenUsage: values.tokenUsage,
            metadata: values.metadata,
            updatedAt: values.updatedAt,
          },
        });
    } catch (cause) {
      throw new SessionStoreError('Failed to save session', {
        backend: this.backendName,
        operation: 'save',
        cause,
        context: {sessionId: session.id},
      });
    }

    if (this.hooks.onAfterSave) await this.hooks.onAfterSave(session);
  }

  async load(tenantId: string, sessionId: string): Promise<PersistedSession | null> {
    this.ensureOpen('load');

    try {
      const rows = await this.db
        .select()
        .from(this.table)
        .where(and(eq(this.table.id, sessionId), eq(this.table.tenantId, tenantId)))
        .limit(1);

      if (rows.length === 0) return null;
      return rowToPersistedSession(this.backendName, rows[0]);
    } catch (cause) {
      if (cause instanceof SessionStoreError) throw cause;
      throw new SessionStoreError('Failed to load session', {
        backend: this.backendName,
        operation: 'load',
        cause,
        context: {sessionId, tenantId},
      });
    }
  }

  async list(tenantId: string, opts?: SessionListOptions): Promise<SessionListResult> {
    this.ensureOpen('list');

    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const where = buildListConditions(this.backendName, tenantId, opts, this.table);

    try {
      const rows = await this.db
        .select()
        .from(this.table)
        .where(where)
        .orderBy(desc(this.table.updatedAt), desc(this.table.id))
        .limit(limit + 1); // +1 to detect "is there a next page"

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const sessions = page.map((r) => rowToPersistedSession(this.backendName, r));

      const nextCursor = hasMore
        ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id)
        : null;

      return {sessions, nextCursor};
    } catch (cause) {
      if (cause instanceof SessionStoreError) throw cause;
      throw new SessionStoreError('Failed to list sessions', {
        backend: this.backendName,
        operation: 'list',
        cause,
        context: {tenantId},
      });
    }
  }

  async delete(tenantId: string, sessionId: string): Promise<boolean> {
    this.ensureOpen('delete');

    let result: Array<{id: string}>;
    try {
      result = await this.db
        .delete(this.table)
        .where(and(eq(this.table.id, sessionId), eq(this.table.tenantId, tenantId)))
        .returning({id: this.table.id});
    } catch (cause) {
      throw new SessionStoreError('Failed to delete session', {
        backend: this.backendName,
        operation: 'delete',
        cause,
        context: {sessionId, tenantId},
      });
    }

    const deleted = result.length > 0;
    if (deleted && this.hooks.onAfterDelete) {
      await this.hooks.onAfterDelete(sessionId);
    }
    return deleted;
  }

  async cleanup(before: Date): Promise<number> {
    this.ensureOpen('cleanup');

    let result: Array<{id: string}>;
    try {
      result = await this.db
        .delete(this.table)
        .where(lt(this.table.updatedAt, before))
        .returning({id: this.table.id});
    } catch (cause) {
      throw new SessionStoreError('Failed to cleanup sessions', {
        backend: this.backendName,
        operation: 'cleanup',
        cause,
        context: {before: before.toISOString()},
      });
    }

    if (result.length > 0) {
      this.logger.info('session_store_cleanup', {
        backend: this.backendName,
        deleted: result.length,
      });
    }

    if (this.hooks.onAfterCleanup) {
      await this.hooks.onAfterCleanup({deleted: result.length, before});
    }
    return result.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.onClose();
    } catch (cause) {
      throw new SessionStoreError('Failed to close session store', {
        backend: this.backendName,
        operation: 'close',
        cause,
      });
    }
  }

  private ensureOpen(operation: string): void {
    if (this.closed) {
      throw new SessionStoreError('Session store is closed', {
        backend: this.backendName,
        operation,
      });
    }
  }
}
