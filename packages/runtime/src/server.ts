/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

 

/**
 * Hosted server.
 *
 * Creates the Express server for hosted mode with all routes, session
 * management, and graceful shutdown. Uses StandaloneSessionManager
 * instead of the old gemini-cli-core-based SessionManager.
 */

import express from 'express';
import type {Express} from 'express';
import type http from 'node:http';
import type {AgentBundle, ChannelAdapter, ChannelSessionMapper} from '@amodalai/types';
import {errorHandler} from './middleware/error-handler.js';
import {createChatStreamRouter} from './routes/chat-stream.js';
import {createAIStreamRouter} from './routes/ai-stream.js';
import {StandaloneSessionManager} from './session/manager.js';
import type {StreamHooks} from './session/stream-hooks.js';
import type {AuthContext} from './middleware/auth.js';
import type {SessionComponents} from './session/session-builder.js';
import type {ServerConfig} from './types.js';
import {RuntimeEventBus} from './events/event-bus.js';
import {createChannelsRouter} from './channels/routes.js';
import {MessageDedupCache} from './channels/dedup-cache.js';
import {log, createLogger} from './logger.js';
import {defaultRoleProvider, type RoleProvider} from './role-provider.js';
import {asyncHandler} from './routes/route-helpers.js';

export interface ServerInstance {
  app: Express;
  start: () => Promise<http.Server>;
  stop: () => Promise<void>;
}

export interface CreateServerOptions {
  /** Server configuration */
  config: ServerConfig;
  /** Version string for /version endpoint */
  version?: string;
  /** Middleware to mount before all routes (e.g., request enrichment) */
  preMiddleware?: express.RequestHandler;
  /** Middleware to mount before the error handler (e.g., static file serving) */
  fallbackMiddleware?: express.RequestHandler;
  /** Auth middleware for protected routes (injected by hosting layer) */
  authMiddleware?: express.RequestHandler;
  /**
   * RoleProvider for role-gated routes (config editing, admin actions, etc).
   *
   * Defaults to `defaultRoleProvider` which returns `ops` for all requests —
   * appropriate for `amodal dev` where the developer is the only user.
   *
   * Hosting layers (cloud, self-hosted) should provide their own implementation
   * that maps the request's auth context to a `user`/`admin`/`ops` role.
   *
   * The runtime exposes the resolved role at `GET /api/me` and uses it to
   * gate config-editing routes via the `requireRole` middleware.
   */
  roleProvider?: RoleProvider;
  /** Additional routers to mount (e.g., session history proxy) */
  additionalRouters?: express.Router[];
  /** Factory that builds per-request stream hooks from the auth context */
  createStreamHooks?: (auth?: AuthContext) => StreamHooks;
  /** Summarizer hook for evicted tool results (passed through to runMessage). */
  summarizeToolResult?: (opts: {
    toolName: string;
    content: string;
    signal: AbortSignal;
  }) => Promise<string>;
  /** Shutdown callback for hosting layer cleanup (e.g., drain audit batches) */
  onShutdown?: () => Promise<void>;
  /** Async callback that resolves an AgentBundle from a deploy ID (used by hosted runtime) */
  bundleProvider?: (deployId: string, token?: string) => Promise<AgentBundle | null>;
  /**
   * Hook called after session components are built but before the session
   * is created. Allows the hosting layer to enhance components — e.g.,
   * injecting role-based field guidance into the system prompt.
   */
  onSessionBuild?: (
    components: SessionComponents,
    context: { auth?: AuthContext; bundle: AgentBundle },
  ) => SessionComponents | Promise<SessionComponents>;

  // --- Messaging channels (optional) ---

  /**
   * Pre-loaded channel adapters. The hosting layer calls
   * `loadChannelPlugins()` and passes the result here.
   */
  channelAdapters?: Map<string, ChannelAdapter>;
  /**
   * Channel session mapper. The hosting layer creates this with its
   * own DB connection (DrizzleChannelSessionMapper) or uses the
   * InMemoryChannelSessionMapper for testing.
   */
  channelSessionMapper?: ChannelSessionMapper & {
    setSessionFactory(f: (origin: import('@amodalai/types').ChannelOrigin) => {sessionId: string}): void;
  };
  /** Event bus for channel lifecycle events. If omitted, a minimal one is created. */
  channelEventBus?: RuntimeEventBus;
}

/**
 * Create the Express server with all routes, session management, and graceful shutdown.
 */
export function createServer(options: CreateServerOptions): ServerInstance {
  const {config} = options;
  const startedAt = Date.now();

  // --- Session management ---
  const sessionLogger = createLogger({component: 'hosted-session'});
  const sessionManager = new StandaloneSessionManager({
    logger: sessionLogger,
    ttlMs: config.sessionTtlMs,
  });
  sessionManager.start();

  const shared = {
    storeBackend: null,
    mcpManager: null,
    logger: log,
  };

  // --- Express app ---
  const app = express();

  // CORS middleware
  const corsOrigin = config.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Expose-Headers', 'x-vercel-ai-ui-message-stream');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Pre-route middleware (e.g., request enrichment in hosted mode)
  if (options.preMiddleware) {
    app.use(options.preMiddleware);
  }

  // Health
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: options.version,
      uptime_ms: Date.now() - startedAt,
      active_sessions: sessionManager.size,
    });
  });

  // RoleProvider — defaults to "everyone is ops" for amodal dev / backwards compat.
  // Hosting layers inject their own provider via createServer options.
  const roleProvider = options.roleProvider ?? defaultRoleProvider;

  // GET /api/me — returns the current user's role.
  // Used by the runtime-app frontend to decide which nav items / pages to show.
  // Returns 401 if unauthenticated, otherwise { id, role }.
  app.get('/api/me', asyncHandler(async (req, res) => {
    const user = await roleProvider.resolveUser(req);
    if (!user) {
      log.warn('api_me_unauthenticated', {path: req.path});
      res.status(401).json({
        error: {code: 'unauthenticated', message: 'Authentication required'},
      });
      return;
    }
    log.debug('api_me_resolved', {user_id: user.id, role: user.role});
    res.json(user);
  }));

  // Auth middleware for protected routes (injected by hosting layer)
  if (options.authMiddleware) {
    app.use('/chat', options.authMiddleware);
    app.use('/chat/stream', options.authMiddleware);
    app.use('/sessions', options.authMiddleware);
  }

  app.use(createChatStreamRouter({
    sessionManager,
    bundleResolver: {bundleProvider: options.bundleProvider},
    shared,
    createStreamHooks: options.createStreamHooks,
    summarizeToolResult: options.summarizeToolResult,
    onSessionBuild: options.onSessionBuild,
  }));
  app.use(createAIStreamRouter({
    sessionManager,
    bundleResolver: {bundleProvider: options.bundleProvider},
    shared,
    createStreamHooks: options.createStreamHooks,
    summarizeToolResult: options.summarizeToolResult,
    onSessionBuild: options.onSessionBuild,
  }));

  // Messaging channels
  if (options.channelAdapters && options.channelAdapters.size > 0 && options.channelSessionMapper) {
    const channelEventBus = options.channelEventBus ?? new RuntimeEventBus({
      onListenerError: (err, event) => {
        log.warn('channel_event_bus_listener_error', {
          seq: event.seq,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    });

    app.use('/channels', createChannelsRouter({
      adapters: options.channelAdapters,
      sessionMapper: options.channelSessionMapper,
      sessionManager,
      dedupCache: new MessageDedupCache(),
      eventBus: channelEventBus,
      logger: log,
    }));

    log.info('channels_router_mounted', {channels: [...options.channelAdapters.keys()]});
  }

  // Additional routers (e.g., session history proxy from hosting layer)
  if (options.additionalRouters) {
    for (const router of options.additionalRouters) {
      app.use(router);
    }
  }

  // Fallback middleware (e.g., static file serving for custom domains)
  if (options.fallbackMiddleware) {
    app.use(options.fallbackMiddleware);
  }

  // Error handler (must be last)
  app.use(errorHandler);

  let server: http.Server | null = null;

  return {
    app,

    async start(): Promise<http.Server> {
      return new Promise((resolve) => {
        const httpServer = app.listen(config.port, config.host, () => {
          log.info('hosted_server_started', {host: config.host, port: config.port});
          resolve(httpServer);
        });
        server = httpServer;
      });
    },

    async stop(): Promise<void> {
      if (server) {
        const s = server;
        await new Promise<void>((resolve, reject) => {
          s.close((err) => {
            if (err) reject(err);
            else resolve();
          });
          s.closeAllConnections();
        });
        server = null;
      }

      if (options.onShutdown) {
        await options.onShutdown();
      }

      await sessionManager.shutdown();

      log.info('hosted_server_stopped', {});
    },
  };
}
