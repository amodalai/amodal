/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * In-memory channel session mapper.
 *
 * Simple Map-backed implementation for environments without a database
 * (snapshot preview server, testing). Sessions are not persisted across
 * restarts — that's fine for preview and test use cases.
 */

import type {ChannelSessionMapper, ChannelSessionMapResult, ChannelOrigin} from '@amodalai/types';
import type {CreateChannelSession} from './channel-session-mapper.js';
import type {Logger} from '../logger.js';

export interface InMemoryChannelSessionMapperOptions {
  logger: Logger;
  eventBus?: {
    emit(payload: {type: string; [key: string]: unknown}): unknown;
  };
}

export class InMemoryChannelSessionMapper implements ChannelSessionMapper {
  private readonly sessions = new Map<string, string>();
  private readonly logger: Logger;
  private readonly eventBus?: InMemoryChannelSessionMapperOptions['eventBus'];
  private createSession: CreateChannelSession | null = null;

  constructor(opts: InMemoryChannelSessionMapperOptions) {
    this.logger = opts.logger;
    this.eventBus = opts.eventBus;
  }

  setSessionFactory(factory: CreateChannelSession): void {
    this.createSession = factory;
  }

  async findOrCreateSession(
    channelType: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<ChannelSessionMapResult> {
    const key = `${channelType}:${channelUserId}`;
    const existing = this.sessions.get(key);

    if (existing) {
      this.logger.debug('channel_session_found', {channelType, channelUserId, sessionId: existing});
      return {sessionId: existing, isNew: false};
    }

    if (!this.createSession) {
      throw new Error('Channel session mapper: session factory not set. Call setSessionFactory() first.');
    }

    const channelOrigin: ChannelOrigin = {
      channelType,
      channelUserId,
      channelUserDisplay: displayName,
    };
    const {sessionId} = this.createSession(channelOrigin);
    this.sessions.set(key, sessionId);

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
    const key = `${channelType}:${channelUserId}`;
    this.sessions.delete(key);
    this.logger.info('channel_session_reset', {channelType, channelUserId});
  }
}
