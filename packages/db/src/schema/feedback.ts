/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Feedback table — replaces file-based JSON feedback storage.
 */

import {pgTable, text, jsonb, timestamp, index} from 'drizzle-orm/pg-core';

export const feedback = pgTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    sessionId: text('session_id').notNull(),
    messageId: text('message_id').notNull(),
    rating: text('rating').notNull(), // 'up' | 'down'
    comment: text('comment'),
    query: text('query').notNull(),
    response: text('response').notNull(),
    toolCalls: jsonb('tool_calls').$type<unknown[]>(),
    model: text('model'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', {withTimezone: true}),
  },
  (t) => [
    index('idx_feedback_agent').on(t.agentId),
    index('idx_feedback_session').on(t.sessionId),
  ],
);
