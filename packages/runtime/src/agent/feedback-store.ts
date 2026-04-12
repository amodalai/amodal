/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres-backed feedback store.
 *
 * Persists user feedback (thumbs up/down) to the shared Postgres
 * database via Drizzle ORM. Replaces the previous file-based JSON
 * implementation.
 */

import {eq, desc, inArray, count, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {randomUUID} from 'node:crypto';
import {getDb, feedback, notifyFeedbackCreated} from '@amodalai/db';
import {StoreError} from '../errors.js';

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  messageId: string;
  rating: 'up' | 'down';
  comment?: string;
  query: string;
  response: string;
  toolCalls?: string[];
  model?: string;
  timestamp: string;
  reviewedAt?: string;
}

export interface FeedbackSummary {
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  recentDown: FeedbackEntry[];
}

/**
 * Persists user feedback (thumbs up/down) to Postgres.
 */
export class FeedbackStore {
  private readonly agentId: string;
  private readonly db: NodePgDatabase;

  constructor({agentId}: {agentId: string}) {
    this.agentId = agentId;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getDb returns Db which extends NodePgDatabase
    this.db = getDb() as unknown as NodePgDatabase;
  }

  async save(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): Promise<FeedbackEntry> {
    const id = randomUUID();
    const now = new Date();
    const full: FeedbackEntry = {
      ...entry,
      id,
      timestamp: now.toISOString(),
    };

    try {
      await this.db.insert(feedback).values({
        id: full.id,
        agentId: this.agentId,
        sessionId: full.sessionId,
        messageId: full.messageId,
        rating: full.rating,
        comment: full.comment ?? null,
        query: full.query,
        response: full.response,
        toolCalls: full.toolCalls ?? null,
        model: full.model ?? null,
        createdAt: now,
      });
    } catch (err) {
      throw new StoreError('Failed to save feedback', {
        store: 'feedback',
        operation: 'save',
        cause: err,
        context: {agentId: this.agentId, feedbackId: id},
      });
    }

    // Best-effort NOTIFY — don't fail the write.
    try {
      await notifyFeedbackCreated(this.db, {
        feedbackId: id,
        agentId: this.agentId,
        sessionId: full.sessionId,
      });
    } catch {
      // Best-effort notification.
    }

    return full;
  }

  async list(limit = 100): Promise<FeedbackEntry[]> {
    try {
      const rows = await this.db
        .select()
        .from(feedback)
        .where(eq(feedback.agentId, this.agentId))
        .orderBy(desc(feedback.createdAt))
        .limit(limit);

      return rows.map((r) => this.rowToEntry(r));
    } catch (err) {
      throw new StoreError('Failed to list feedback', {
        store: 'feedback',
        operation: 'list',
        cause: err,
        context: {agentId: this.agentId},
      });
    }
  }

  async summary(): Promise<FeedbackSummary> {
    try {
      const counts = await this.db
        .select({rating: feedback.rating, count: count()})
        .from(feedback)
        .where(eq(feedback.agentId, this.agentId))
        .groupBy(feedback.rating);

      let thumbsUp = 0;
      let thumbsDown = 0;
      for (const row of counts) {
        if (row.rating === 'up') thumbsUp = Number(row.count);
        else if (row.rating === 'down') thumbsDown = Number(row.count);
      }

      const unreviewedDown = await this.db
        .select()
        .from(feedback)
        .where(
          sql`${feedback.agentId} = ${this.agentId} AND ${feedback.rating} = 'down' AND ${feedback.reviewedAt} IS NULL`,
        )
        .orderBy(desc(feedback.createdAt))
        .limit(20);

      return {
        total: thumbsUp + thumbsDown,
        thumbsUp,
        thumbsDown,
        recentDown: unreviewedDown.map((r) => this.rowToEntry(r)),
      };
    } catch (err) {
      throw new StoreError('Failed to summarize feedback', {
        store: 'feedback',
        operation: 'summary',
        cause: err,
        context: {agentId: this.agentId},
      });
    }
  }

  /** Mark feedback entries as reviewed so they're excluded from the next synthesis. */
  async markReviewed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.db
        .update(feedback)
        .set({reviewedAt: new Date()})
        .where(inArray(feedback.id, ids));
    } catch (err) {
      throw new StoreError('Failed to mark feedback reviewed', {
        store: 'feedback',
        operation: 'markReviewed',
        cause: err,
        context: {agentId: this.agentId, ids},
      });
    }
  }

  private rowToEntry(row: typeof feedback.$inferSelect): FeedbackEntry {
    return {
      id: row.id,
      sessionId: row.sessionId,
      messageId: row.messageId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB constraint ensures 'up' | 'down'
      rating: row.rating as 'up' | 'down',
      comment: row.comment ?? undefined,
      query: row.query,
      response: row.response,
       
      toolCalls: row.toolCalls ? (row.toolCalls).map(String) : undefined,
      model: row.model ?? undefined,
      timestamp: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString(),
    };
  }
}
