/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Drizzle schema for PGLite / Postgres tables.
 *
 * Phase 3.4 defined `agentSessions` here. Phase 4.3b added the store
 * document tables so both PGLite (local dev) and Postgres (hosted runtime)
 * share one schema and migrate together.
 */

import {pgTable, text, integer, jsonb, timestamp, serial, primaryKey, index} from 'drizzle-orm/pg-core';
import type {StoreDocumentMeta} from '@amodalai/types';

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  messages: jsonb('messages').notNull().$type<unknown[]>(),
  tokenUsage: jsonb('token_usage').notNull().$type<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>(),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Store documents
// ---------------------------------------------------------------------------

export const storeDocuments = pgTable(
  'store_documents',
  {
    appId: text('app_id').notNull(),
    store: text('store').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    meta: jsonb('meta').notNull().$type<StoreDocumentMeta>(),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({columns: [t.appId, t.store, t.key]}),
    storeIdx: index('idx_store_documents_store').on(t.appId, t.store),
    expiresIdx: index('idx_store_documents_expires').on(t.expiresAt),
  }),
);

export const storeDocumentVersions = pgTable(
  'store_document_versions',
  {
    id: serial('id').primaryKey(),
    appId: text('app_id').notNull(),
    store: text('store').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    meta: jsonb('meta').notNull().$type<StoreDocumentMeta>(),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => ({
    lookupIdx: index('idx_store_versions_lookup').on(t.appId, t.store, t.key, t.version),
  }),
);
