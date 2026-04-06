/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * PGLite factory for the session store.
 *
 * Opens an in-process WASM Postgres (PGLite), runs idempotent DDL,
 * and returns a `DrizzleSessionStore` wired to it. Thin factory —
 * all query logic lives in DrizzleSessionStore.
 *
 * Default choice for `amodal dev`: zero config, no Docker, no DB to
 * manage. Pair with `createPostgresSessionStore` for hosted runtime
 * or ISV production deployments.
 */

import {drizzle} from 'drizzle-orm/pglite';

import {agentSessions} from '../stores/schema.js';
import {log as defaultLogger} from '../logger.js';
import type {Logger} from '../logger.js';
import {DrizzleSessionStore} from './drizzle-session-store.js';
import type {SessionStoreHooks} from './store.js';

const BACKEND_NAME = 'pglite';

// Must match the Drizzle schema in ../stores/schema.ts exactly.
const CREATE_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    messages JSONB NOT NULL,
    token_usage JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated
    ON agent_sessions (updated_at DESC);

  CREATE TABLE IF NOT EXISTS channel_sessions (
    channel_type TEXT NOT NULL,
    channel_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    PRIMARY KEY (channel_type, channel_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_channel_sessions_session
    ON channel_sessions (session_id);
  CREATE INDEX IF NOT EXISTS idx_channel_sessions_activity
    ON channel_sessions (last_active_at DESC);
`;

export interface PGLiteSessionStoreOptions {
  /** Data directory for PGLite. If unset, runs fully in-memory. */
  dataDir?: string;
  /** Logger. Defaults to the runtime's global logger. */
  logger?: Logger;
  /** Optional hooks for dual-write / observability. */
  hooks?: SessionStoreHooks;
}

/**
 * Create and initialize a PGLite-backed session store.
 *
 * Returns a `DrizzleSessionStore` whose `close()` will close the
 * underlying PGLite instance.
 */
export async function createPGLiteSessionStore(
  opts: PGLiteSessionStoreOptions = {},
): Promise<DrizzleSessionStore> {
  const logger = opts.logger ?? defaultLogger;

  if (opts.dataDir) {
    const {mkdirSync} = await import('node:fs');
    mkdirSync(opts.dataDir, {recursive: true});
  }

  // Dynamic import keeps PGLite lazy — Postgres-only deployments don't
  // need to pay the WASM parsing cost.
  const {PGlite} = await import('@electric-sql/pglite');
  const pglite = new PGlite(opts.dataDir ?? undefined);
  await pglite.exec(CREATE_TABLE_DDL);

  const db = drizzle(pglite);

  logger.info('session_store_initialized', {
    backend: BACKEND_NAME,
    dataDir: opts.dataDir ?? 'in-memory',
  });

  return new DrizzleSessionStore({
    db,
    table: agentSessions,
    backendName: BACKEND_NAME,
    logger,
    hooks: opts.hooks,
    onClose: async () => {
      await pglite.close();
    },
  });
}
