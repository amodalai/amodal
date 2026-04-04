/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import express from 'express';
import type { Express } from 'express';
import type http from 'node:http';
import type { ConfigParameters } from '@amodalai/core';
import { errorHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './routes/health.js';
import { createChatStreamRouter } from './routes/chat-stream-legacy.js';
import { createWebhookRouter } from './routes/webhooks.js';
import { createWidgetActionsRouter } from './routes/widget-actions.js';
import { createAskUserResponseRouter } from './routes/ask-user-response.js';
import { createAIStreamRouter } from './routes/ai-stream-legacy.js';
import { SessionManager } from './session/session-manager.js';
import { createAutomationRunner } from './cron/heartbeat-runner.js';
import { AutomationScheduler } from './cron/heartbeat-scheduler.js';
import type { StreamHooks } from './session/session-runner.js';
import type { AuthContext } from './middleware/auth.js';
import type { SessionStore } from './session/session-manager.js';
import type { ServerConfig } from './types.js';
import { log } from './logger.js';

export interface ServerInstance {
  app: Express;
  start: () => Promise<http.Server>;
  stop: () => Promise<void>;
}

export interface CreateServerOptions {
  /** Base ConfigParameters for session creation */
  baseParams: Partial<ConfigParameters>;
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
  /** Pluggable session store for hydrating sessions (e.g., platform API, local DB) */
  sessionStore?: SessionStore;
  /** Shutdown callback for hosting layer cleanup (e.g., drain audit batches) */
  onShutdown?: () => Promise<void>;
  /** Async callback that resolves an AgentBundle from a deploy ID (used by hosted runtime) */
  bundleProvider?: (deployId: string, token?: string) => Promise<import('@amodalai/core').AgentBundle | null>;
}

/**
 * Create the Express server with all routes, session management,
 * automation scheduling, and graceful shutdown.
 */
export function createServer(options: CreateServerOptions): ServerInstance {
  const { baseParams, config } = options;
  const startedAt = Date.now();

  // --- Session management ---
  const sessionManager = new SessionManager({
    baseParams,
    ttlMs: config.sessionTtlMs,
    sessionStore: options.sessionStore,
    bundleProvider: options.bundleProvider,
  });

  // --- Automation runner ---
  const runAutomation = createAutomationRunner({
    sessionManager,
    streamHooks: options.createStreamHooks?.(),
  });

  // --- Automation scheduler (cron) ---
  const automationScheduler = new AutomationScheduler();

  // --- Express app ---
  const app = express();

  // CORS middleware
  const corsOrigin = config.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    );
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    res.header(
      'Access-Control-Expose-Headers',
      'x-vercel-ai-ui-message-stream',
    );
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

  // Routes
  app.use(
    createHealthRouter({
      sessionManager,
      version: options.version,
      startedAt,
    }),
  );

  // Auth middleware for protected routes (injected by hosting layer)
  if (options.authMiddleware) {
    app.use('/chat', options.authMiddleware);
    app.use('/chat/stream', options.authMiddleware);
    app.use('/sessions', options.authMiddleware);
  }

  app.use(createChatStreamRouter({ sessionManager, createStreamHooks: options.createStreamHooks }));
  app.use(createAIStreamRouter({ sessionManager, createStreamHooks: options.createStreamHooks }));
  app.use(createWidgetActionsRouter({ sessionManager }));
  app.use(createAskUserResponseRouter({ sessionManager }));

  // Additional routers (e.g., session history proxy from hosting layer)
  if (options.additionalRouters) {
    for (const router of options.additionalRouters) {
      app.use(router);
    }
  }

  app.use(
    createWebhookRouter({
      automations: config.automations,
      runAutomation,
    }),
  );

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
      // Start cron automations
      automationScheduler.start(config.automations, runAutomation);

      return new Promise((resolve) => {
        const httpServer = app.listen(config.port, config.host, () => {
          log.info(`Server listening on ${config.host}:${config.port}`);
          resolve(httpServer);
        });
        server = httpServer;
      });
    },

    async stop(): Promise<void> {
      // Stop cron jobs
      automationScheduler.stop();

      // Close HTTP server
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

      // Hosting layer cleanup (e.g., drain audit batches)
      if (options.onShutdown) {
        await options.onShutdown();
      }

      // Drain sessions
      await sessionManager.shutdown();

      log.info('Server stopped');
    },
  };
}
