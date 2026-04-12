/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle-ORM SessionStore implementation.
 *
 * Shared Drizzle-ORM SessionStore implementation. The Postgres factory
 * constructs the underlying db client and hands the result here along
 * with a table binding and an `onClose` callback for teardown.
 *
 * Mirrors the `DrizzleStoreBackend` pattern introduced in amodal#146.
 *
 * Errors bubble up as SessionStoreError — callers at module edges
 * (session manager, routes) are responsible for handling.
 */

import {eq, lt, desc} from 'drizzle-orm';
import type {PgDatabase, PgQueryResultHKT} from 'drizzle-orm/pg-core';

import {SessionStoreError} from '../errors.js';
import type {Logger} from '../logger.js';
import type {PersistedSession} from './types.js';

import type {agentSessions} from '@amodalai/db';
import {notifySessionUpdated} from '@amodalai/db';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
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
 * The `agentSessions` table from `@amodalai/db` satisfies this type.
 */
export type AgentSessionsTable = typeof agentSessions;

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const DEFAULT_LIST_LIMIT = 50;

export interface DrizzleSessionStoreOptions {
  /** Drizzle database instance (from `drizzle-orm/node-postgres`). */
  db: AnyPgDatabase;
  /** Table binding — `agentSessions` (default name) or a dynamic table for custom names. */
  table: AgentSessionsTable;
  /** Backend name used in log + error context (e.g. 'postgres'). */
  backendName: string;
  /** Logger for structured events. */
  logger: Logger;
  /** Optional post-mutation hooks (dual-write, observability). */
  hooks?: SessionStoreHooks;
  /** Cleanup callback — the factory's way to tear down its pool / WASM instance. */
  onClose: () => Promise<void>;
}

export class DrizzleSessionStore implements SessionStore {
  /** Exposed for channel session mapper to share the connection pool. */
  readonly db: AnyPgDatabase;
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
            imageData: values.imageData,
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

    // Best-effort NOTIFY so Studio/listeners see session updates in real time.
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle db is NodePgDatabase
      await notifySessionUpdated(this.db as unknown as NodePgDatabase, {sessionId: session.id});
    } catch (err) {
      this.logger.warn('session_notify_failed', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (this.hooks.onAfterSave) await this.hooks.onAfterSave(session);
  }

  async load(sessionId: string): Promise<PersistedSession | null> {
    this.ensureOpen('load');

    try {
      const rows = await this.db
        .select()
        .from(this.table)
        .where(eq(this.table.id, sessionId))
        .limit(1);

      if (rows.length === 0) return null;
      return rowToPersistedSession(this.backendName, rows[0]);
    } catch (cause) {
      if (cause instanceof SessionStoreError) throw cause;
      throw new SessionStoreError('Failed to load session', {
        backend: this.backendName,
        operation: 'load',
        cause,
        context: {sessionId},
      });
    }
  }

  async list(opts?: SessionListOptions): Promise<SessionListResult> {
    this.ensureOpen('list');

    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const where = buildListConditions(this.backendName, opts, this.table);

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
      });
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    this.ensureOpen('delete');

    let result: Array<{id: string}>;
    try {
      result = await this.db
        .delete(this.table)
        .where(eq(this.table.id, sessionId))
        .returning({id: this.table.id});
    } catch (cause) {
      throw new SessionStoreError('Failed to delete session', {
        backend: this.backendName,
        operation: 'delete',
        cause,
        context: {sessionId},
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
