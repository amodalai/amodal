/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

 

/**
 * Shared channel bootstrap sequence.
 *
 * Used by local-server.ts, snapshot-server.ts, and available for
 * hosting layers that call createServer(). Loads channel plugins,
 * wires the session mapper, and creates the Express router.
 */

import type {Router} from 'express';
import type {ChannelAdapter, ChannelSessionMapper, ChannelOrigin} from '@amodalai/types';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {SessionComponents} from '../session/session-builder.js';
import type {RuntimeEventBus} from '../events/event-bus.js';
import type {Logger} from '../logger.js';
import type {CreateChannelSession} from './channel-session-mapper.js';
import {loadChannelPlugins} from './plugin-loader.js';
import {createChannelsRouter} from './routes.js';
import {MessageDedupCache} from './dedup-cache.js';
import {resolveEnvRef} from '../env-ref.js';

/** A discovered channel from the bundle (matches AgentBundle['channels'][n]). */
interface BundleChannel {
  channelType: string;
  packageName: string;
  packageDir: string;
  config: Record<string, unknown>;
}

export interface BootstrapChannelsOptions {
  /** Discovered channel plugins from the bundle. */
  channels: BundleChannel[];
  /** Repo path for local channel discovery + node_modules resolution. */
  repoPath: string;
  /** The `packages` array from amodal.json. */
  packages?: string[];
  /**
   * Pre-wired session mapper. The caller chooses the implementation:
   * - DrizzleChannelSessionMapper (local-server, hosted with DB)
   * - InMemoryChannelSessionMapper (snapshot-server, testing)
   */
  sessionMapper: ChannelSessionMapper & {setSessionFactory(f: CreateChannelSession): void};
  sessionManager: StandaloneSessionManager;
  /** Factory that builds session components for new channel sessions. */
  buildSessionComponents: () => SessionComponents;
  /** App ID for sessions created by channels (e.g. 'local'). */
  appId?: string;
  eventBus: RuntimeEventBus;
  logger: Logger;
}

export interface BootstrapChannelsResult {
  adapters: Map<string, ChannelAdapter>;
  router: Router;
}

/**
 * Load channel plugins, wire the session factory, and create the
 * Express router. Returns null if loading fails (error is logged).
 */
export async function bootstrapChannels(
  opts: BootstrapChannelsOptions,
): Promise<BootstrapChannelsResult | null> {
  const {channels, repoPath, sessionMapper, sessionManager, buildSessionComponents, eventBus, logger} = opts;
  const appId = opts.appId ?? 'local';

  if (channels.length === 0) {
    return null;
  }

  try {
    // Build and resolve env:VAR refs in channel config values
    const channelsConfig: Record<string, unknown> = {};
    for (const ch of channels) {
      channelsConfig[ch.channelType] = resolveChannelConfig(ch.config);
    }

    // Load and validate plugins
    const adapters = await loadChannelPlugins({channelsConfig, repoPath, packages: opts.packages, logger});
    logger.info('channels_loaded', {channels: [...adapters.keys()]});

    // Wire session factory — creates chat sessions for channel users
    sessionMapper.setSessionFactory((origin: ChannelOrigin) => {
      const components = buildSessionComponents();
      const channelNote = `\n\n[Channel context: This user is messaging you via ${origin.channelType}. Keep responses concise and conversational. User: ${origin.channelUserDisplay ?? origin.channelUserId}.]`;

      const session = sessionManager.create({
        provider: components.provider,
        toolRegistry: components.toolRegistry,
        permissionChecker: components.permissionChecker,
        systemPrompt: components.systemPrompt + channelNote,
        toolContextFactory: components.toolContextFactory,
        appId,
        metadata: {channelOrigin: origin},
      });
      return {sessionId: session.id};
    });

    // Build the router
    const router = createChannelsRouter({
      adapters,
      sessionMapper,
      sessionManager,
      dedupCache: new MessageDedupCache(),
      eventBus,
      logger,
    });

    return {adapters, router};
  } catch (err) {
    logger.error('channels_load_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve `env:VAR_NAME` references in a channel config block.
 */
function resolveChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string') {
      resolved[k] = resolveEnvRef(v) ?? v;
    } else if (Array.isArray(v)) {
      resolved[k] = v.map((item) =>
        typeof item === 'string' ? (resolveEnvRef(item) ?? item) : item,
      );
    } else {
      resolved[k] = v;
    }
  }
  return resolved;
}
