/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Store document tables.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  serial,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const storeDocuments = pgTable(
  'store_documents',
  {
    appId: text('app_id').notNull(),
    scopeId: text('scope_id').notNull().default(''),
    store: text('store').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    meta: jsonb('meta').notNull().$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({columns: [t.appId, t.scopeId, t.store, t.key]}),
    index('idx_store_documents_store').on(t.appId, t.scopeId, t.store),
    index('idx_store_documents_expires').on(t.expiresAt),
  ],
);

export const storeDocumentVersions = pgTable(
  'store_document_versions',
  {
    id: serial('id').primaryKey(),
    appId: text('app_id').notNull(),
    scopeId: text('scope_id').notNull().default(''),
    store: text('store').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    meta: jsonb('meta').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => [
    index('idx_store_versions_lookup').on(t.appId, t.scopeId, t.store, t.key, t.version),
  ],
);
