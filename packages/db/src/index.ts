/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * @amodalai/db — shared Drizzle ORM schema package.
 *
 * Provides table definitions, a connection singleton, typed NOTIFY
 * wrappers, and a LISTEN client for real-time Postgres notifications.
 */

// Schema exports
export * from './schema/index.js';

// Connection
export { createDbPool, getDb, closeDb } from './connection.js';
export type { Db, DbSchema } from './connection.js';

// Notifications
export {
  NOTIFY_CHANNELS,
  notifyStoreUpdated,
  notifySessionUpdated,
  notifyFeedbackCreated,
  notifyAutomationStarted,
  notifyAutomationCompleted,
} from './notify.js';
export type {
  NotifyChannel,
  StoreUpdatedPayload,
  SessionUpdatedPayload,
  FeedbackCreatedPayload,
  AutomationStartedPayload,
  AutomationCompletedPayload,
} from './notify.js';

// Listener
export { createPgListener } from './listen.js';
export type { PgListener, PgChannel } from './listen.js';

// Migration
export { ensureSchema } from './migrate.js';

// Re-export common drizzle-orm operators so downstream packages
// (like @amodalai/studio) use the same drizzle-orm instance and
// avoid type conflicts from duplicate installs.
export {
  eq,
  and,
  or,
  desc,
  asc,
  count,
  sql,
  inArray,
} from 'drizzle-orm';
