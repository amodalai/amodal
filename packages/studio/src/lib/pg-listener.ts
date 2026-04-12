/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Singleton LISTEN connection for real-time Postgres notifications.
 *
 * Subscribes to all NOTIFY_CHANNELS from @amodalai/db on first access.
 */

import { createPgListener, NOTIFY_CHANNELS } from '@amodalai/db';
import type { PgListener } from '@amodalai/db';
import { logger } from './logger';

let listener: PgListener | null = null;

const DATABASE_URL_ENV = 'DATABASE_URL';

/**
 * Get or create the singleton PgListener, subscribed to all
 * notification channels.
 */
export async function getPgListener(): Promise<PgListener> {
  if (listener) return listener;

  const url = process.env[DATABASE_URL_ENV];
  if (!url) {
    throw new Error(`${DATABASE_URL_ENV} is required for Postgres LISTEN`);
  }

  const start = Date.now();
  listener = await createPgListener(url);

  for (const channel of NOTIFY_CHANNELS) {
    await listener.listen(channel);
  }

  logger.info('pg_listener_initialized', {
    channels: NOTIFY_CHANNELS.length,
    duration_ms: Date.now() - start,
  });

  return listener;
}

/**
 * Close the singleton listener. Used for graceful shutdown and testing.
 */
export async function closePgListener(): Promise<void> {
  if (listener) {
    await listener.close();
    listener = null;
  }
}
