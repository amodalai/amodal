/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Studio drafts table.
 */

import {pgTable, text, timestamp, primaryKey} from 'drizzle-orm/pg-core';

export const studioDrafts = pgTable(
  'studio_drafts',
  {
    userId: text('user_id').notNull(),
    filePath: text('file_path').notNull(),
    content: text('content').notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({columns: [t.userId, t.filePath]}),
  ],
);
