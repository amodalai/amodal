/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Typed wrappers around Postgres NOTIFY. Each function takes a Drizzle
 * db instance and a typed payload, and issues a pg_notify() call.
 */

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export const NOTIFY_CHANNELS = [
  'store_updated',
  'session_updated',
  'feedback_created',
  'automation_started',
  'automation_completed',
] as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface StoreUpdatedPayload {
  agentId: string;
  store: string;
  key: string;
}

export interface SessionUpdatedPayload {
  sessionId: string;
}

export interface FeedbackCreatedPayload {
  feedbackId: string;
  agentId: string;
  sessionId: string;
}

export interface AutomationStartedPayload {
  agentId: string;
  name: string;
  runId: number;
}

export interface AutomationCompletedPayload {
  agentId: string;
  name: string;
  runId: number;
  status: string;
}

async function notify(db: NodePgDatabase, channel: NotifyChannel, payload: unknown): Promise<void> {
  const serialized = JSON.stringify(payload);
  await db.execute(sql`SELECT pg_notify(${channel}, ${serialized})`);
}

export async function notifyStoreUpdated(
  db: NodePgDatabase,
  payload: StoreUpdatedPayload,
): Promise<void> {
  await notify(db, 'store_updated', payload);
}

export async function notifySessionUpdated(
  db: NodePgDatabase,
  payload: SessionUpdatedPayload,
): Promise<void> {
  await notify(db, 'session_updated', payload);
}

export async function notifyFeedbackCreated(
  db: NodePgDatabase,
  payload: FeedbackCreatedPayload,
): Promise<void> {
  await notify(db, 'feedback_created', payload);
}

export async function notifyAutomationStarted(
  db: NodePgDatabase,
  payload: AutomationStartedPayload,
): Promise<void> {
  await notify(db, 'automation_started', payload);
}

export async function notifyAutomationCompleted(
  db: NodePgDatabase,
  payload: AutomationCompletedPayload,
): Promise<void> {
  await notify(db, 'automation_completed', payload);
}
