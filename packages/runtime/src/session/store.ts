/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session persistence layer (Phase 3.4).
 *
 * Defines the `SessionStore` interface and a PGLite implementation
 * backed by Drizzle ORM. The Drizzle schema is in `stores/schema.ts`
 * so it can be shared with store tables when Phase 4.3b ships.
 */

import {eq, lt, desc} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/pglite';
import {agentSessions} from '../stores/schema.js';
import type {PersistedSession, SessionMetadata} from './types.js';
import type {TokenUsage} from '../providers/types.js';
import type {ModelMessage} from 'ai';
import type {Logger} from '../logger.js';
import {ConfigError} from '../errors.js';

// ---------------------------------------------------------------------------
// SessionStore interface
// ---------------------------------------------------------------------------

/**
 * Interface for session persistence backends.
 *
 * Implementations: PGLiteSessionStore (local dev), future Postgres
 * (hosted runtime via shared Drizzle schema).
 */
export interface SessionStore {
  /** Initialize the backing store (create tables, run migrations). */
  initialize(): Promise<void>;

  /** Save or update a session. */
  save(session: PersistedSession): Promise<void>;

  /** Load a session by ID. Returns null if not found. */
  load(sessionId: string): Promise<PersistedSession | null>;

  /** List sessions for a tenant, newest first. */
  list(tenantId: string, opts?: {limit?: number}): Promise<PersistedSession[]>;

  /** Delete a session by ID. Returns true if deleted. */
  delete(sessionId: string): Promise<boolean>;

  /** Delete sessions not updated since `before`. Returns count deleted. */
  cleanup(before: Date): Promise<number>;

  /** Close the backing store. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// PGLite implementation
// ---------------------------------------------------------------------------

/**
 * PGLite-backed session store using Drizzle ORM.
 *
 * Runs an in-process WASM Postgres instance. Data is persisted to a
 * configurable directory (default: in-memory).
 */
export class PGLiteSessionStore implements SessionStore {
  private db: ReturnType<typeof drizzle> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGLite instance type is not exported cleanly
  private pglite: any = null;
  private readonly dataDir: string | undefined;
  private readonly logger: Logger;

  constructor(opts: {dataDir?: string; logger: Logger}) {
    this.dataDir = opts.dataDir;
    this.logger = opts.logger;
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    if (this.dataDir) {
      const {mkdirSync} = await import('node:fs');
      mkdirSync(this.dataDir, {recursive: true});
    }

    const {PGlite} = await import('@electric-sql/pglite');
    this.pglite = new PGlite(this.dataDir ?? undefined);
    this.db = drizzle(this.pglite);

    // Create table via raw SQL — Drizzle schema defines the shape,
    // but we use raw DDL for initialization (no drizzle-kit in runtime).
    await this.pglite.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages JSONB NOT NULL,
        token_usage JSONB NOT NULL,
        metadata JSONB DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant
        ON agent_sessions (tenant_id, updated_at DESC);
    `);

    this.logger.info('session_store_initialized', {
      dataDir: this.dataDir ?? 'in-memory',
    });
  }

  async save(session: PersistedSession): Promise<void> {
    this.ensureDb();

    const values = {
      id: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      messages: session.messages as unknown[],
      tokenUsage: session.tokenUsage as {inputTokens: number; outputTokens: number; totalTokens: number},
      metadata: session.metadata as Record<string, unknown>,
      version: session.version,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    await this.db!
      .insert(agentSessions)
      .values(values)
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          messages: values.messages,
          tokenUsage: values.tokenUsage,
          metadata: values.metadata,
          updatedAt: values.updatedAt,
        },
      });
  }

  async load(sessionId: string): Promise<PersistedSession | null> {
    this.ensureDb();

    const rows = await this.db!
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToPersistedSession(rows[0]);
  }

  async list(tenantId: string, opts?: {limit?: number}): Promise<PersistedSession[]> {
    this.ensureDb();

    const rows = await this.db!
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.tenantId, tenantId))
      .orderBy(desc(agentSessions.updatedAt))
      .limit(opts?.limit ?? 50);

    return rows.map(rowToPersistedSession);
  }

  async delete(sessionId: string): Promise<boolean> {
    this.ensureDb();

    const result = await this.db!
      .delete(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .returning({id: agentSessions.id});

    return result.length > 0;
  }

  async cleanup(before: Date): Promise<number> {
    this.ensureDb();

    const result = await this.db!
      .delete(agentSessions)
      .where(lt(agentSessions.updatedAt, before))
      .returning({id: agentSessions.id});

    if (result.length > 0) {
      this.logger.info('session_store_cleanup', {deleted: result.length});
    }

    return result.length;
  }

  async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
      this.db = null;
    }
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new ConfigError('PGLiteSessionStore not initialized — call initialize() first', {
        key: 'sessionStore',
        suggestion: 'Call initialize() before using the session store',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

function rowToPersistedSession(row: typeof agentSessions.$inferSelect): PersistedSession {
  return {
    version: 1,
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSONB boundary: we wrote these values
    messages: row.messages as ModelMessage[],
     
    tokenUsage: row.tokenUsage as TokenUsage,
     
    metadata: (row.metadata ?? {}) as SessionMetadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
