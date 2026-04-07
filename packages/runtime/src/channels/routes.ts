/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

 

/**
 * Express router for inbound messaging channel webhooks.
 *
 * Mirrors the `createWebhookRouter` pattern from routes/webhooks.ts:
 * rate-limited, dispatches to registered channel adapters, and runs
 * the message through the existing SessionManager.
 *
 * Route: POST /channels/:channelType/webhook
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import type {ChannelAdapter, ChannelSessionMapper, ChannelWebhookRequest} from '@amodalai/types';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {MessageDedupCache} from './dedup-cache.js';
import type {RuntimeEventBus} from '../events/event-bus.js';
import type {Logger} from '../logger.js';
import {asyncHandler} from '../routes/route-helpers.js';

const ROUTE_PATH = '/:channelType/webhook';
const RESET_COMMANDS = new Set(['/reset', '/start', '/new']);
const PREVIEW_LENGTH = 50;
const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export interface ChannelsRouterOptions {
  adapters: Map<string, ChannelAdapter>;
  sessionMapper: ChannelSessionMapper;
  sessionManager: StandaloneSessionManager;
  dedupCache: MessageDedupCache;
  eventBus: RuntimeEventBus;
  logger: Logger;
}

export function createChannelsRouter(options: ChannelsRouterOptions): Router {
  const {adapters, sessionMapper, sessionManager, dedupCache, eventBus, logger} = options;
  const router = Router();

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    validate: {xForwardedForHeader: false},
  });

  router.post(ROUTE_PATH, limiter, asyncHandler(async (req: Request, res: Response) => {
    const channelType = req.params['channelType'] ?? '';
    const adapter = adapters.get(channelType);

    if (!adapter) {
      res.status(404).json({error: `Unknown channel type: ${channelType}`});
      return;
    }

    // Build framework-agnostic request for the adapter
    const webhookReq: ChannelWebhookRequest = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
    };

    // Parse and verify the incoming message
    const msg = await adapter.parseIncoming(webhookReq);
    if (!msg) {
      // Rejected (bad signature, unauthorized sender, or non-text update).
      // Always return 200 — platforms retry on non-200.
      eventBus.emit({
        type: 'channel_auth_rejected',
        channelType,
        reason: 'bad_signature',
      });
      res.status(200).json({ok: true});
      return;
    }

    // Dedup check (Telegram resends on slow 200s)
    if (dedupCache.isDuplicate(msg.channelType, msg.messageId)) {
      logger.debug('channel_message_duplicate', {channelType, messageId: msg.messageId});
      res.status(200).json({ok: true});
      return;
    }

    // Handle special reset commands
    if (RESET_COMMANDS.has(msg.text.trim().toLowerCase())) {
      await sessionMapper.resetSession(msg.channelType, msg.channelUserId);
      await adapter.sendMessage(
        {channelType: msg.channelType, conversationId: msg.conversationId},
        'Session reset. Send a message to start a new conversation.',
      );
      res.status(200).json({ok: true});
      return;
    }

    // Emit inbound event
    eventBus.emit({
      type: 'channel_message_received',
      channelType: msg.channelType,
      channelUserId: msg.channelUserId,
      sessionId: '', // Will be filled after session lookup
      messagePreview: msg.text.slice(0, PREVIEW_LENGTH),
    });

    try {
      // Find or create session
      let {sessionId} = await sessionMapper.findOrCreateSession(
        msg.channelType,
        msg.channelUserId,
        msg.channelUserDisplay,
      );

      // If the session isn't in memory (evicted or server restarted),
      // reset the stale mapping and create a fresh session.
      if (!sessionManager.get(sessionId)) {
        logger.debug('channel_session_stale', {channelType: msg.channelType, sessionId});
        await sessionMapper.resetSession(msg.channelType, msg.channelUserId);
        const fresh = await sessionMapper.findOrCreateSession(
          msg.channelType,
          msg.channelUserId,
          msg.channelUserDisplay,
        );
        sessionId = fresh.sessionId;
      }

      // Notify the adapter that processing is starting (adapter decides how to show it)
      const cleanup = adapter.startProcessing
        ? await adapter.startProcessing(msg.conversationId)
        : null;

      // Run the message through the agent loop, collecting the full reply
      const replyParts: string[] = [];
      try {
        const stream = sessionManager.runMessage(sessionId, msg.text);

        for await (const event of stream) {
          if (event.type === 'text_delta' && 'content' in event) {
            replyParts.push(String(event.content));
          }
        }
      } finally {
        cleanup?.stop();
      }

      const fullReply = replyParts.join('');
      if (fullReply.length > 0) {
        // Let the adapter deliver the response (may edit a placeholder or send fresh)
        const delivered = cleanup
          ? await cleanup.finish(fullReply)
          : false;

        if (!delivered) {
          await adapter.sendMessage(
            {channelType: msg.channelType, conversationId: msg.conversationId},
            fullReply,
          );
        }

        eventBus.emit({
          type: 'channel_reply_sent',
          channelType: msg.channelType,
          channelUserId: msg.channelUserId,
          sessionId,
          replyPreview: fullReply.slice(0, PREVIEW_LENGTH),
        });
      }
    } catch (err) {
      logger.error('channel_message_failed', {
        channelType: msg.channelType,
        channelUserId: msg.channelUserId,
        messageId: msg.messageId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Send a user-friendly error message
      try {
        await adapter.sendMessage(
          {channelType: msg.channelType, conversationId: msg.conversationId},
          FALLBACK_ERROR_MESSAGE,
        );
      } catch {
        // If even the error message fails, just log — can't do more
        logger.error('channel_error_reply_failed', {
          channelType: msg.channelType,
          channelUserId: msg.channelUserId,
        });
      }
    }

    // Always return 200 to prevent Telegram retries
    res.status(200).json({ok: true});
  }));

  return router;
}
