/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Local-dev runner for `@amodalai/studio`.
 *
 * Lives in its own file (separate from `studio-server.ts`) so importing
 * the library has zero side effects: nothing happens until something
 * explicitly invokes this bin. The bin opens a TCP port, starts the PG
 * `LISTEN` bridge, and registers shutdown handlers — all of which are
 * wrong for serverless embedders like cloud-studio on Vercel.
 *
 * Run via the package's `start` script (`node dist-server/bin.js`).
 */

import { serve } from '@hono/node-server';
import { logger } from '../lib/logger.js';
import { initEventBridge } from '../lib/event-bridge.js';
import { closePgListener } from '../lib/pg-listener.js';
import { createStudioApp } from './studio-server.js';

const DEFAULT_PORT = 3848;

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? String(DEFAULT_PORT), 10);
  const app = createStudioApp();

  await initEventBridge();

  const hostname = process.env['HOSTNAME'] ?? 'localhost';
  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info('studio_server_started', { port });
  });

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
