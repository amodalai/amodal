/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle-based channel session mapper.
 *
 * Maps (channelType, channelUserId) → sessionId using the
 * `channel_sessions` table. Shares the same database connection pool
 * as the session store to avoid opening a second connection.
 */

import {eq, and, sql} from 'drizzle-orm';
import type {PgDatabase, PgQueryResultHKT} from 'drizzle-orm/pg-core';

import type {ChannelSessionMapper, ChannelSessionMapResult, ChannelOrigin} from '@amodalai/types';
import type {Logger} from '../logger.js';
import {channelSessions} from '../stores/schema.js';

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface ChannelSessionMapperOptions {
  db: AnyPgDatabase;
  logger: Logger;
  eventBus?: {
    emit(payload: {type: string; [key: string]: unknown}): unknown;
  };
}

/**
 * Create a new session for a channel user. The caller provides the
 * session factory so the mapper stays decoupled from session creation
 * details (provider selection, tool registration, etc.).
 */
export type CreateChannelSession = (
  channelOrigin: ChannelOrigin,
) => {sessionId: string};

export class DrizzleChannelSessionMapper implements ChannelSessionMapper {
  private readonly db: AnyPgDatabase;
  private readonly logger: Logger;
  private readonly eventBus?: ChannelSessionMapperOptions['eventBus'];
  private createSession: CreateChannelSession | null = null;

  constructor(opts: ChannelSessionMapperOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.eventBus = opts.eventBus;
  }

  /**
   * Wire the session factory after construction. Called by the local-server
   * wiring code once all session components are available.
   */
  setSessionFactory(factory: CreateChannelSession): void {
    this.createSession = factory;
  }

  async findOrCreateSession(
    channelType: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<ChannelSessionMapResult> {
    // Try to find an existing mapping
    const rows = await this.db
      .select({sessionId: channelSessions.sessionId})
      .from(channelSessions)
      .where(
        and(
          eq(channelSessions.channelType, channelType),
          eq(channelSessions.channelUserId, channelUserId),
        ),
      )
      .limit(1);

    if (rows.length > 0) {
      const {sessionId} = rows[0]!;
      // Update last_active_at
      await this.db
        .update(channelSessions)
        .set({lastActiveAt: sql`NOW()`})
        .where(
          and(
            eq(channelSessions.channelType, channelType),
            eq(channelSessions.channelUserId, channelUserId),
          ),
        );

      this.logger.debug('channel_session_found', {channelType, channelUserId, sessionId});
      return {sessionId, isNew: false};
    }

    // Create new session
    if (!this.createSession) {
      throw new Error('Channel session mapper: session factory not set. Call setSessionFactory() first.');
    }

    const channelOrigin: ChannelOrigin = {
      channelType,
      channelUserId,
      channelUserDisplay: displayName,
    };
    const {sessionId} = this.createSession(channelOrigin);

    // Persist the mapping
    await this.db.insert(channelSessions).values({
      channelType,
      channelUserId,
      sessionId,
      metadata: {channelUserDisplay: displayName},
    });

    this.logger.info('channel_session_created', {channelType, channelUserId, sessionId});
    this.eventBus?.emit({
      type: 'channel_session_created',
      channelType,
      channelUserId,
      sessionId,
    });

    return {sessionId, isNew: true};
  }

  async resetSession(
    channelType: string,
    channelUserId: string,
  ): Promise<void> {
    await this.db
      .delete(channelSessions)
      .where(
        and(
          eq(channelSessions.channelType, channelType),
          eq(channelSessions.channelUserId, channelUserId),
        ),
      );
    this.logger.info('channel_session_reset', {channelType, channelUserId});
  }
}
