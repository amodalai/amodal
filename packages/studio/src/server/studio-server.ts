/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { initEventBridge } from '../lib/event-bridge.js';
import { closePgListener } from '../lib/pg-listener.js';
import { loadEvalsFromDisk } from '../lib/eval-loader.js';
import { getBackend } from '../lib/startup.js';
import { getAgentId } from '../lib/config.js';
import { configRouter } from './routes/config.js';
import { workspaceRouter } from './routes/workspace.js';
import { draftsRouter } from './routes/drafts.js';
import { publishRouter } from './routes/publish.js';
import { discardRouter } from './routes/discard.js';
import { previewRouter } from './routes/preview.js';
import { storesRouter } from './routes/stores.js';
import { automationsRouter } from './routes/automations.js';
import { evalsRouter } from './routes/evals.js';
import { feedbackRouter } from './routes/feedback.js';
import { memoryRouter } from './routes/memory.js';
import { eventsRouter } from './routes/events.js';
import { adminChatRouter } from './routes/admin-chat.js';
import { runtimeProxyRouter } from './routes/runtime-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 3848;

// ---------------------------------------------------------------------------
// Re-exports for cloud-studio (so everything is available from ./server)
// ---------------------------------------------------------------------------

export { setAuthProvider, getUser } from '../lib/auth.js';
export type { StudioAuth } from '../lib/auth.js';
export { setBackendFactory, getBackend, resetBackend } from '../lib/startup.js';
export type { BackendFactory } from '../lib/startup.js';
export { DrizzleStudioBackend } from '../lib/drizzle-backend.js';
export type { DrizzleStudioBackendOptions } from '../lib/drizzle-backend.js';
export { StudioError, StudioPublishError, StudioStorageError, StudioPathError, StudioFeatureUnavailableError } from '../lib/errors.js';
export type { StudioUser, DraftFile, PublishResult, WorkspaceBundle } from '../lib/types.js';
export { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export interface CreateStudioAppOptions {
  /** Whether to serve the Vite SPA static files. Defaults to true. */
  serveStaticFiles?: boolean;
}

/**
 * Create the Studio Express app with all middleware and routes mounted.
 * Does NOT call `listen()` — the caller is responsible for starting the server.
 *
 * Used by:
 * - `main()` below for local dev (`amodal studio` / `amodal dev`)
 * - Cloud deployments that need the Express app as a serverless handler
 */
export function createStudioApp(options: CreateStudioAppOptions = {}): express.Express {
  const { serveStaticFiles = true } = options;
  const app = express();

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  app.use('/api', corsMiddleware);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ limit: '10mb' }));

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------

  app.use(configRouter);
  app.use(workspaceRouter);
  app.use(draftsRouter);
  app.use(publishRouter);
  app.use(discardRouter);
  app.use(previewRouter);
  app.use(storesRouter);
  app.use(automationsRouter);
  app.use(evalsRouter);
  app.use(feedbackRouter);
  app.use(memoryRouter);
  app.use(eventsRouter);
  app.use(adminChatRouter);
  app.use(runtimeProxyRouter);

  // ---------------------------------------------------------------------------
  // Static files + SPA catch-all (production)
  // ---------------------------------------------------------------------------

  if (serveStaticFiles) {
    // In source: __dirname is src/server → ../../dist
    // When bundled: __dirname is dist-server → ../dist
    // Use process.cwd() as fallback since the CLI sets cwd to studioDir
    const distDir = existsSync(path.resolve(__dirname, '..', '..', 'dist', 'index.html'))
      ? path.resolve(__dirname, '..', '..', 'dist')
      : path.resolve(__dirname, '..', 'dist');
    if (existsSync(path.join(distDir, 'index.html'))) {
      app.use(express.static(distDir));
      app.get('{*path}', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Error handler (must be last)
  // ---------------------------------------------------------------------------

  app.use(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Local dev entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? String(DEFAULT_PORT), 10);
  const app = createStudioApp();

  await initEventBridge();

  // -------------------------------------------------------------------------
  // Load eval suites from disk into Postgres
  // -------------------------------------------------------------------------

  const repoPath = process.env['REPO_PATH'];
  if (repoPath) {
    // Ensure backend (and therefore schema) is initialized before loading evals
    await getBackend();
    const agentId = getAgentId();
    try {
      const loaded = await loadEvalsFromDisk(repoPath, agentId);
      if (loaded > 0) {
        logger.info('eval_suites_loaded_at_startup', { agentId, loaded });
      }
    } catch (err: unknown) {
      logger.warn('eval_suites_load_failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const server = app.listen(port, 'localhost', () => {
    logger.info('studio_server_started', { port });
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('studio_server_shutdown', { signal });
    await closePgListener();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('studio_server_fatal', { error: message });
  process.exit(1);
});
