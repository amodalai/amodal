/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session tables — ported from packages/runtime/src/stores/schema.ts.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    messages: jsonb('messages').notNull().$type<unknown[]>(),
    tokenUsage: jsonb('token_usage').notNull().$type<{
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>(),
    metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
    imageData: jsonb('image_data').default({}).$type<Record<string, {mimeType: string; data: string}>>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  },
  (t) => [
    index('idx_agent_sessions_updated').on(t.updatedAt),
  ],
);

export const channelSessions = pgTable(
  'channel_sessions',
  {
    channelType: text('channel_type').notNull(),
    channelUserId: text('channel_user_id').notNull(),
    sessionId: text('session_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', {withTimezone: true}).defaultNow().notNull(),
    metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({columns: [t.channelType, t.channelUserId]}),
    index('idx_channel_sessions_session').on(t.sessionId),
    index('idx_channel_sessions_activity').on(t.lastActiveAt),
  ],
);
