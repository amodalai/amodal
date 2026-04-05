/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session persistence layer — interface, types, and shared helpers.
 *
 * Concrete implementations:
 *   - `DrizzleSessionStore` (./drizzle-session-store.ts) — the single
 *     query layer shared by both backends.
 *   - `createPGLiteSessionStore` (./pglite-session-store.ts) — factory
 *     for local-dev / in-memory PGLite.
 *   - `createPostgresSessionStore` (./postgres-session-store.ts) —
 *     factory for hosted runtime / ISV production.
 *
 * The Drizzle schema lives in `../stores/schema.ts`, shared with the
 * store document tables.
 */

import {and, eq, lt, or, gte, lte, sql} from 'drizzle-orm';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
import type {agentSessions} from '../stores/schema.js';
import type {PersistedSession, SessionMetadata} from './types.js';
import type {TokenUsage} from '../providers/types.js';
import type {ModelMessage} from 'ai';
import {SessionStoreError} from '../errors.js';

// ---------------------------------------------------------------------------
// List options, hooks, and cursor type
// ---------------------------------------------------------------------------

/**
 * Options for `SessionStore.list()`.
 *
 * Cursor-based pagination over `updated_at` (newest first). The cursor
 * encodes the updatedAt/id pair of the last row returned — pass it back
 * unchanged to fetch the next page.
 *
 * Filters match against metadata JSONB paths using equality. Only
 * `snake_case` / simple identifier keys are accepted — see
 * `validateFilterKey` for the exact rules. Passing an untrusted key
 * throws `SessionStoreError`.
 *
 * `updatedAfter` / `updatedBefore` filter by the `updated_at` column
 * (inclusive). Useful for "sessions touched this week" queries.
 */
export interface SessionListOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly updatedAfter?: Date;
  readonly updatedBefore?: Date;
}

/**
 * Result of `SessionStore.list()` — sessions plus an opaque cursor
 * for the next page. `nextCursor` is `null` when there are no more rows.
 */
export interface SessionListResult {
  readonly sessions: PersistedSession[];
  readonly nextCursor: string | null;
}

/**
 * Optional callbacks fired after mutations. Each hook is awaited, so
 * a failing hook propagates to the caller. Keep hooks fast — they sit
 * on the write path.
 *
 * Intended use: dual-write to a consumer's own table (hosted-runtime
 * adoption path), emit observability events, invalidate caches.
 */
export interface SessionStoreHooks {
  onAfterSave?: (session: PersistedSession) => Promise<void> | void;
  onAfterDelete?: (sessionId: string) => Promise<void> | void;
  onAfterCleanup?: (opts: {deleted: number; before: Date}) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// SessionStore interface
// ---------------------------------------------------------------------------

/**
 * Interface for session persistence backends.
 *
 * One concrete implementation (`DrizzleSessionStore`) with two factories:
 * `createPGLiteSessionStore` for local dev, `createPostgresSessionStore`
 * for hosted runtime / ISV production. Both share the `agentSessions`
 * Drizzle schema and the query helpers in this module.
 */
export interface SessionStore {
  /** Initialize the backing store (create tables, run migrations). */
  initialize(): Promise<void>;

  /**
   * Save or update a session.
   *
   * **Semantics: last-write-wins.** The implementation does an
   * unconditional `onConflictDoUpdate` — no optimistic-concurrency
   * version check. If two concurrent `save()` calls target the same
   * session ID, the later write silently overwrites the earlier one,
   * including any messages the earlier caller added.
   *
   * **Callers must serialize per-session writes.** The built-in
   * `StandaloneSessionManager` does this by routing all writes for a
   * session through a single in-memory object. External callers that
   * share a session across workers must either (a) use a single
   * writer per session, or (b) wrap `save()` with their own advisory
   * locking. The `version` column is persisted and surfaced on read
   * but is currently informational only — reserved for future OCC.
   */
  save(session: PersistedSession): Promise<void>;

  /** Load a session by id. Returns null if not found. */
  load(sessionId: string): Promise<PersistedSession | null>;

  /**
   * List sessions for a tenant, newest first.
   *
   * Returns sessions + a pagination cursor. The `tenantId` parameter
   * filters by the `tenant_id` column — it's an ordinary filter, not
   * a security boundary. Callers that need multi-tenant isolation
   * should namespace their session IDs directly (e.g.
   * `tenant-a:session-123`).
   */
  list(tenantId: string, opts?: SessionListOptions): Promise<SessionListResult>;

  /** Delete a session by id. Returns true if a row was deleted. */
  delete(sessionId: string): Promise<boolean>;

  /** Delete sessions not updated since `before`. Returns count deleted. */
  cleanup(before: Date): Promise<number>;

  /** Close the backing store. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers — used by both PGLite and Postgres implementations
// ---------------------------------------------------------------------------

/**
 * Reject filter keys that could be used for SQL injection. We only
 * allow simple identifiers: letters, digits, underscores. The keys
 * become part of a JSONB path (`metadata->>'key'`) so they must be
 * safe to interpolate.
 */
const SAFE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateFilterKey(backend: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new SessionStoreError(
      `Invalid filter field name: ${JSON.stringify(key)}`,
      {
        backend,
        operation: 'list',
        context: {key, expected: 'identifier: letters, digits, underscore only'},
      },
    );
  }
}

/** Encode a cursor as opaque base64 of "updatedAt.ms|id". */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.getTime()}|${id}`, 'utf8').toString('base64url');
}

/** Decode a cursor; throws SessionStoreError on malformed input. */
export function decodeCursor(
  backend: string,
  cursor: string,
): {updatedAt: Date; id: string} {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep < 0) throw new Error('missing separator');
    const ms = Number(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(ms) || !id) throw new Error('bad parts');
    return {updatedAt: new Date(ms), id};
  } catch (cause) {
    throw new SessionStoreError('Invalid pagination cursor', {
      backend,
      operation: 'list',
      cause,
    });
  }
}

/**
 * Map a `PersistedSession` to its row shape for insert/update. Separate
 * function so both backends do the exact same type conversion.
 */
export function sessionToRow(session: PersistedSession): {
  id: string;
  tenantId: string;
  userId: string;
  messages: unknown[];
  tokenUsage: {inputTokens: number; outputTokens: number; totalTokens: number};
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: session.id,
    tenantId: session.tenantId,
    userId: session.userId,
    messages: session.messages as unknown[],
    tokenUsage: session.tokenUsage as {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    metadata: session.metadata as Record<string, unknown>,
    version: session.version,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Inverse of `sessionToRow`.
 *
 * Validates at the JSONB boundary: rejects rows with an unknown
 * `version` (future schema migration signal) or a non-array `messages`
 * payload (would indicate a malformed write from an older runtime or
 * manual DB edit). Throws `SessionStoreError` with context when a row
 * fails validation rather than returning a quietly-broken session
 * that crashes deep in the agent loop.
 */
export function rowToPersistedSession(
  backend: string,
  row: typeof agentSessions.$inferSelect,
): PersistedSession {
  if (row.version !== 1) {
    throw new SessionStoreError(
      `Unsupported persisted session version: ${row.version}`,
      {
        backend,
        operation: 'load',
        context: {sessionId: row.id, version: row.version, supported: 1},
      },
    );
  }
  if (!Array.isArray(row.messages)) {
    throw new SessionStoreError('Persisted session has non-array messages payload', {
      backend,
      operation: 'load',
      context: {sessionId: row.id, messagesType: typeof row.messages},
    });
  }
  return {
    version: 1,
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSONB boundary: array-shape checked above; element shape is not validated
    messages: row.messages as ModelMessage[],

    tokenUsage: row.tokenUsage as TokenUsage,

    metadata: (row.metadata ?? {}) as SessionMetadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Structural shape the `buildListConditions` helper needs. Any
 * `agent_sessions`-compatible Drizzle pgTable (default name or a
 * consumer-supplied one) satisfies this — both backends use the same
 * column names, only the table name differs.
 */
export interface AgentSessionsColumns {
  tenantId: AnyPgColumn;
  updatedAt: AnyPgColumn;
  id: AnyPgColumn;
  metadata: AnyPgColumn;
}

/**
 * Build the where-clause fragments for `list()`. Generic over the
 * table's column bindings so both PGLite (static `agentSessions`) and
 * Postgres (dynamic `makeAgentSessionsTable(name)`) pass their own
 * tables without a cast.
 */
export function buildListConditions(
  backend: string,
  tenantId: string,
  opts: SessionListOptions | undefined,
  table: AgentSessionsColumns,
): ReturnType<typeof and> {
  const conditions = [eq(table.tenantId, tenantId)];

  if (opts?.cursor) {
    const {updatedAt: cursorTs, id: cursorId} = decodeCursor(backend, opts.cursor);
    // Compound (updated_at, id) comparison makes pagination stable even
    // when multiple rows share the same `updated_at` (batch inserts in
    // the same ms, clock-skewed sources). Matches the secondary sort
    // key on `id` used by list() so every row is visited exactly once.
    const cursorCondition = or(
      lt(table.updatedAt, cursorTs),
      and(eq(table.updatedAt, cursorTs), lt(table.id, cursorId)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  if (opts?.updatedAfter) conditions.push(gte(table.updatedAt, opts.updatedAfter));
  if (opts?.updatedBefore) conditions.push(lte(table.updatedAt, opts.updatedBefore));

  if (opts?.filter) {
    for (const [key, val] of Object.entries(opts.filter)) {
      validateFilterKey(backend, key);
      // metadata->>'key' = value (string equality). JSONB `->>` returns
      // text; we coerce the user-supplied value to its JSON string form
      // via parameter binding, so non-string values like numbers/bools
      // compare correctly: metadata->>'n' = '42'.
      const textVal = typeof val === 'string' ? val : JSON.stringify(val);
      conditions.push(
        sql`${table.metadata}->>${sql.raw(`'${key}'`)} = ${textVal}`,
      );
    }
  }

  return and(...conditions);
}
