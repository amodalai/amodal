/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for reading feedback data from Postgres.
 * Used by Studio's feedback pages.
 */

import { eq, desc, count, inArray, feedback } from '@amodalai/db';
import { getStudioDb } from './db';

const DEFAULT_FEEDBACK_LIMIT = 500;

/**
 * List feedback entries for an agent, ordered newest-first.
 */
export async function listFeedback(agentId: string, limit = DEFAULT_FEEDBACK_LIMIT) {
  const db = await getStudioDb();
  return db
    .select()
    .from(feedback)
    .where(eq(feedback.agentId, agentId))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

/**
 * Get an aggregate summary of feedback ratings for an agent.
 */
export async function getFeedbackSummary(agentId: string) {
  const db = await getStudioDb();
  const rows = await db
    .select({ rating: feedback.rating, total: count() })
    .from(feedback)
    .where(eq(feedback.agentId, agentId))
    .groupBy(feedback.rating);

  const up = rows.find((r) => r.rating === 'up')?.total ?? 0;
  const down = rows.find((r) => r.rating === 'down')?.total ?? 0;
  return { up, down, total: up + down };
}

/**
 * Mark a set of feedback entries as reviewed by setting reviewedAt.
 */
export async function markFeedbackReviewed(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getStudioDb();
  await db
    .update(feedback)
    .set({ reviewedAt: new Date() })
    .where(inArray(feedback.id, ids));
}
