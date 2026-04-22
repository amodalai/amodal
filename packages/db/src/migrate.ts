/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema migration — runs CREATE TABLE IF NOT EXISTS for all tables.
 * Uses raw DDL SQL to match the Drizzle schema definitions exactly.
 *
 * Order matters for foreign key references (none currently, but
 * future-proof by creating referenced tables first).
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

const DDL_STATEMENTS = [
  // --- store_documents ---
  sql`CREATE TABLE IF NOT EXISTS store_documents (
    app_id TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    meta JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_id, scope_id, store, key)
  )`,
  sql`ALTER TABLE store_documents ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT ''`,
  sql`CREATE INDEX IF NOT EXISTS idx_store_documents_store ON store_documents (app_id, scope_id, store)`,
  sql`CREATE INDEX IF NOT EXISTS idx_store_documents_expires ON store_documents (expires_at)`,

  // --- store_document_versions ---
  sql`CREATE TABLE IF NOT EXISTS store_document_versions (
    id SERIAL PRIMARY KEY,
    app_id TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    meta JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`ALTER TABLE store_document_versions ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT ''`,
  sql`CREATE INDEX IF NOT EXISTS idx_store_versions_lookup ON store_document_versions (app_id, scope_id, store, key, version)`,

  // --- agent_sessions ---
  sql`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    messages JSONB NOT NULL,
    token_usage JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    image_data JSONB DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT ''`,
  sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions (updated_at)`,
  sql`CREATE INDEX IF NOT EXISTS idx_sessions_scope ON agent_sessions (scope_id)`,

  // --- channel_sessions ---
  sql`CREATE TABLE IF NOT EXISTS channel_sessions (
    channel_type TEXT NOT NULL,
    channel_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    PRIMARY KEY (channel_type, channel_user_id)
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_channel_sessions_session ON channel_sessions (session_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_channel_sessions_activity ON channel_sessions (last_active_at)`,

  // --- feedback ---
  sql`CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    rating TEXT NOT NULL,
    comment TEXT,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    tool_calls JSONB,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback (agent_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback (session_id)`,

  // --- studio_drafts ---
  sql`CREATE TABLE IF NOT EXISTS studio_drafts (
    user_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_path)
  )`,

  // --- automation_config ---
  sql`CREATE TABLE IF NOT EXISTS automation_config (
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, name)
  )`,

  // --- automation_runs ---
  sql`CREATE TABLE IF NOT EXISTS automation_runs (
    id SERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_automation_runs_agent ON automation_runs (agent_id, name)`,

  // --- eval_suites ---
  sql`CREATE TABLE IF NOT EXISTS eval_suites (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_eval_suites_agent ON eval_suites (agent_id)`,

  // --- eval_runs ---
  sql`CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    model JSONB NOT NULL,
    results JSONB NOT NULL,
    pass_rate REAL NOT NULL,
    total_passed INTEGER NOT NULL,
    total_failed INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    cost_micros INTEGER,
    label TEXT,
    git_sha TEXT,
    triggered_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_eval_runs_suite ON eval_runs (suite_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_eval_runs_agent ON eval_runs (agent_id)`,

  // --- agent_memory (legacy Phase 1 — will be dropped after migration) ---
  sql`CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY DEFAULT 1,
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // --- agent_memory_entries (Phase 2 — entry-per-row) ---
  sql`CREATE TABLE IF NOT EXISTS agent_memory_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT ''`,
  sql`CREATE INDEX IF NOT EXISTS idx_memory_entries_scope ON agent_memory_entries (app_id, scope_id)`,
  sql`CREATE INDEX IF NOT EXISTS idx_memory_entries_search ON agent_memory_entries
    USING GIN (to_tsvector('english', content))`,
] as const;

export async function ensureSchema<T extends Record<string, unknown> = Record<string, never>>(db: NodePgDatabase<T>): Promise<void> {
  for (const statement of DDL_STATEMENTS) {
    await db.execute(statement);
  }
}

/** Exported for testing — the raw DDL statements. */
export { DDL_STATEMENTS };
