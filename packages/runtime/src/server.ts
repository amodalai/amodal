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
import type {AgentBundle} from '@amodalai/types';
import {errorHandler} from './middleware/error-handler.js';
import {createChatStreamRouter} from './routes/chat-stream.js';
import {createAIStreamRouter} from './routes/ai-stream.js';
import {StandaloneSessionManager} from './session/manager.js';
import type {StreamHooks} from './session/stream-hooks.js';
import type {AuthContext} from './middleware/auth.js';
import type {SessionComponents} from './session/session-builder.js';
import type {ServerConfig} from './types.js';
import {log, createLogger} from './logger.js';

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
