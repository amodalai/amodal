/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
// serveStatic removed — we serve files manually with correct MIME types
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';
import { getBasePath } from '../lib/config.js';
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
import { runtimeProxyRoutes } from './routes/runtime-proxy.js';
import { onboardingRoutes } from './routes/onboarding.js';

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
  /** Override the base path. Defaults to `getBasePath()` (reads `BASE_PATH` env). */
  basePath?: string;
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
  const { serveStaticFiles = true, basePath: basePathOverride } = options;
  const basePath = basePathOverride ?? getBasePath();
  const app = new Hono();

  // ---------------------------------------------------------------------------
  // Sub-app: all API routes and static files live under the base path
  // ---------------------------------------------------------------------------

  const sub = new Hono();

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  sub.use('/api/*', cors({
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

  sub.route('', configRoutes);
  sub.route('', workspaceRoutes);
  sub.route('', draftsRoutes);
  sub.route('', publishRoutes);
  sub.route('', discardRoutes);
  sub.route('', previewRoutes);
  sub.route('', storesRoutes);
  sub.route('', automationsRoutes);
  sub.route('', evalsRoutes);
  sub.route('', feedbackRoutes);
  sub.route('', memoryRoutes);
  sub.route('', eventsRoutes);
  sub.route('', adminChatRoutes);
  sub.route('', runtimeProxyRoutes);
  sub.route('', onboardingRoutes);

  // ---------------------------------------------------------------------------
  // Error handler
  // ---------------------------------------------------------------------------

  sub.onError(handleError);

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
      // MIME type map for static assets
      const MIME_TYPES: Record<string, string> = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.map': 'application/json',
      };

      // SPA catch-all + static file serving with correct MIME types
      let rawIndexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf-8');
      if (basePath) {
        rawIndexHtml = rawIndexHtml
          .replace(/href="\//g, `href="${basePath}/`)
          .replace(/src="\//g, `src="${basePath}/`);
      }
      const basePathScript = `<script>window.__STUDIO_BASE_PATH__=${JSON.stringify(basePath)};</script>`;
      const indexHtml = rawIndexHtml.replace('</head>', `${basePathScript}\n</head>`);

      sub.get('*', (c) => {
        const reqPath = basePath && c.req.path.startsWith(basePath)
          ? c.req.path.slice(basePath.length)
          : c.req.path;

        // Don't serve HTML for API routes
        if (reqPath.startsWith('/api/')) {
          return c.notFound();
        }

        // Try to serve static file from dist (must be a file, not a directory)
        const filePath = path.join(distDir, reqPath);
        if (existsSync(filePath) && !filePath.includes('..') && statSync(filePath).isFile()) {
          const ext = path.extname(filePath);
          const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
          const body = readFileSync(filePath);
          return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
        }

        // SPA fallback — return index.html for all other routes
        return c.html(indexHtml);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Mount under base path
  // ---------------------------------------------------------------------------

  if (basePath) {
    app.route(basePath, sub);

    // Redirect bare base path without trailing slash to the SPA
    app.get(basePath, (c) => c.redirect(`${basePath}/`, 301));
  } else {
    app.route('', sub);
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
