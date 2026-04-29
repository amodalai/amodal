/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';
import { getAllowedOrigins } from './middleware/cors.js';
import { handleError } from './middleware/error-handler.js';
import { initEventBridge } from '../lib/event-bridge.js';
import { closePgListener } from '../lib/pg-listener.js';
import { configRoutes } from './routes/config.js';
import { workspaceRoutes } from './routes/workspace.js';
import { draftsRoutes } from './routes/drafts.js';
import { publishRoutes } from './routes/publish.js';
import { discardRoutes } from './routes/discard.js';
import { previewRoutes } from './routes/preview.js';
import { storesRoutes } from './routes/stores.js';
import { automationsRoutes } from './routes/automations.js';
import { evalsRoutes } from './routes/evals.js';
import { feedbackRoutes } from './routes/feedback.js';
import { memoryRoutes } from './routes/memory.js';
import { eventsRoutes } from './routes/events.js';
import { adminChatRoutes } from './routes/admin-chat.js';
import { repoStateRoutes } from './routes/repo-state.js';
import { initRepoRoutes } from './routes/init-repo.js';
import { runtimeProxyRoutes } from './routes/runtime-proxy.js';

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
export { setRuntimeResolver } from '../lib/runtime-client.js';
export type { RuntimeResolver, ResolvedRuntime } from '../lib/runtime-client.js';
export { setPreviewHandler } from './routes/preview.js';
export type { PreviewHandler } from './routes/preview.js';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export interface CreateStudioAppOptions {
  /** Whether to serve the Vite SPA static files. Defaults to true. */
  serveStaticFiles?: boolean;
}

/**
 * Create the Studio Hono app with all middleware and routes mounted.
 * Does NOT start a server — the caller is responsible for that.
 *
 * Used by:
 * - `main()` below for local dev (`amodal studio` / `amodal dev`)
 * - Cloud deployments that need the Hono app as a serverless handler
 */
export function createStudioApp(options: CreateStudioAppOptions = {}): Hono {
  const { serveStaticFiles = true } = options;
  const app = new Hono();

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  app.use('/api/*', cors({
    origin: (origin) => {
      const allowed = getAllowedOrigins();
      return allowed.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }));

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------

  app.route('', configRoutes);
  app.route('', repoStateRoutes);
  app.route('', initRepoRoutes);
  app.route('', workspaceRoutes);
  app.route('', draftsRoutes);
  app.route('', publishRoutes);
  app.route('', discardRoutes);
  app.route('', previewRoutes);
  app.route('', storesRoutes);
  app.route('', automationsRoutes);
  app.route('', evalsRoutes);
  app.route('', feedbackRoutes);
  app.route('', memoryRoutes);
  app.route('', eventsRoutes);
  app.route('', adminChatRoutes);
  app.route('', runtimeProxyRoutes);

  // ---------------------------------------------------------------------------
  // Error handler
  // ---------------------------------------------------------------------------

  app.onError(handleError);

  // ---------------------------------------------------------------------------
  // Static files + SPA catch-all (production)
  // ---------------------------------------------------------------------------

  if (serveStaticFiles) {
    // In source: __dirname is src/server -> ../../dist
    // When bundled: __dirname is dist-server -> ../dist
    const distDir = existsSync(path.resolve(__dirname, '..', '..', 'dist', 'index.html'))
      ? path.resolve(__dirname, '..', '..', 'dist')
      : path.resolve(__dirname, '..', 'dist');

    if (existsSync(path.join(distDir, 'index.html'))) {
      // Compute the relative path from cwd to distDir for serveStatic
      const relativeRoot = path.relative(process.cwd(), distDir);

      app.use('/*', serveStatic({ root: relativeRoot }));

      // SPA catch-all: serve index.html for non-API routes
      const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf-8');
      app.get('*', (c) => {
        if (c.req.path.startsWith('/api/')) {
          return c.notFound();
        }
        return c.html(indexHtml);
      });
    }
  }

  return app;
}

// ---------------------------------------------------------------------------
// Local dev entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? String(DEFAULT_PORT), 10);
  const app = createStudioApp();

  await initEventBridge();

  const hostname = process.env['HOSTNAME'] ?? 'localhost';
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
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
