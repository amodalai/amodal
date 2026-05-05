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
 *
 * Deployments that use a different real-time mechanism (e.g. Pusher in
 * cloud-studio) call `disableEventBridge()` to skip the LISTEN/NOTIFY path,
 * which avoids opening a persistent pg connection that's incompatible with
 * serverless drivers like neon-http.
 */

import { NOTIFY_CHANNELS } from '@amodalai/db';
import { getPgListener } from './pg-listener';
import { getEventBus } from './event-bus';
import { logger } from './logger';

let bridged = false;
let disabled = false;

/**
 * Disable the Postgres LISTEN bridge. Subsequent calls to `initEventBridge`
 * become no-ops. Use this in deployments that have their own real-time
 * pipeline (e.g. Pusher) and don't want a persistent pg connection opened.
 */
export function disableEventBridge(): void {
  disabled = true;
}

/**
 * Initialize the Postgres listener -> event bus bridge.
 * Idempotent — safe to call multiple times. No-op if disabled.
 */
export async function initEventBridge(): Promise<void> {
  if (disabled) return;
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
  disabled = false;
}
