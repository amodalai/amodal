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
import { createAuthMiddleware } from './middleware/auth.js';
import { createHealthRouter } from './routes/health.js';
import { createChatStreamRouter } from './routes/chat-stream.js';
import { createWebhookRouter } from './routes/webhooks.js';
import { createWidgetActionsRouter } from './routes/widget-actions.js';
import { createAskUserResponseRouter } from './routes/ask-user-response.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createAIStreamRouter } from './routes/ai-stream.js';
import { SessionManager } from './session/session-manager.js';
import { createAutomationRunner } from './cron/heartbeat-runner.js';
import { AutomationScheduler } from './cron/heartbeat-scheduler.js';
import { AuditClient } from './audit/audit-client.js';
import type { ServerConfig } from './types.js';

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
  /** Platform API URL for API key validation (if set, enables auth middleware) */
  platformApiUrl?: string;
  /** JWKS URL for JWT verification (defaults to platformApiUrl/.well-known/jwks.json) */
  jwksUrl?: string;
  /** Middleware to mount before the error handler (e.g., static file serving) */
  fallbackMiddleware?: express.RequestHandler;
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
    platformApiUrl: options.platformApiUrl,
  });

  // --- Audit client (batching HTTP poster to platform API) ---
  const auditClient = options.platformApiUrl
    ? new AuditClient({ platformApiUrl: options.platformApiUrl })
    : undefined;

  // --- Automation runner ---
  const runAutomation = createAutomationRunner({ sessionManager, auditClient });

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

  // Routes
  app.use(
    createHealthRouter({
      sessionManager,
      version: options.version,
      startedAt,
    }),
  );

  // Auth middleware for chat routes (if platform API URL is configured)
  if (options.platformApiUrl) {
    const authMiddleware = createAuthMiddleware({
      platformApiUrl: options.platformApiUrl,
      jwksUrl: options.jwksUrl,
    });
    app.use('/chat', authMiddleware);
    app.use('/chat/stream', authMiddleware);
    app.use('/sessions', authMiddleware);
  }

  app.use(createChatStreamRouter({ sessionManager, auditClient, platformApiUrl: options.platformApiUrl }));
  app.use(createAIStreamRouter({ sessionManager, auditClient, platformApiUrl: options.platformApiUrl }));
  app.use(createWidgetActionsRouter({ sessionManager }));
  app.use(createAskUserResponseRouter({ sessionManager }));
  // Session history proxy routes (requires platform API URL)
  if (options.platformApiUrl) {
    app.use(createSessionsRouter({ platformApiUrl: options.platformApiUrl }));
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
          process.stderr.write(
            `[INFO] Server listening on ${config.host}:${config.port}\n`,
          );
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

      // Drain audit entries
      if (auditClient) {
        await auditClient.shutdown();
      }

      // Drain sessions
      await sessionManager.shutdown();

      process.stderr.write('[INFO] Server stopped\n');
    },
  };
}
