/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Connects the Postgres LISTEN client to the in-process event bus.
 *
 * Called once at startup (from the SSE endpoint). Each Postgres
 * notification is forwarded to the StudioEventBus, which fans it
 * out to all connected SSE clients.
 */

import { NOTIFY_CHANNELS } from '@amodalai/db';
import { getPgListener } from './pg-listener';
import { getEventBus } from './event-bus';
import { logger } from './logger';

let bridged = false;

/**
 * Initialize the Postgres listener -> event bus bridge.
 * Idempotent — safe to call multiple times.
 */
export async function initEventBridge(): Promise<void> {
  if (bridged) return;
  bridged = true;

  const listener = await getPgListener();
  const bus = getEventBus();

  for (const channel of NOTIFY_CHANNELS) {
    listener.on(channel, (payload: unknown) => {
      logger.debug('pg_notification', { channel, payload });
      bus.emit(channel, payload);
    });
  }

  logger.info('event_bridge_initialized', { channels: NOTIFY_CHANNELS.length });
}

/**
 * Reset the bridge flag. Used for testing only.
 */
export function resetEventBridge(): void {
  bridged = false;
}
