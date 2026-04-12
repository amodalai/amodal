/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Persistent LISTEN connection using raw pg.Client (not the pool —
 * LISTEN requires a dedicated connection).
 */

import { Client } from 'pg';
import { EventEmitter } from 'node:events';
import type { NotifyChannel } from './notify.js';

export type PgChannel = NotifyChannel;

export interface PgListener {
  listen(channel: PgChannel): Promise<void>;
  on(channel: string, handler: (payload: unknown) => void): void;
  off(channel: string, handler: (payload: unknown) => void): void;
  close(): Promise<void>;
}

export async function createPgListener(url: string): Promise<PgListener> {
  const client = new Client({connectionString: url});
  await client.connect();
  const emitter = new EventEmitter();

  client.on('notification', (msg) => {
    if (msg.channel && msg.payload) {
      try {
        emitter.emit(msg.channel, JSON.parse(msg.payload));
      } catch (_parseError: unknown) {
        // Payload was not valid JSON — emit the raw string
        emitter.emit(msg.channel, msg.payload);
      }
    }
  });

  return {
    async listen(channel: PgChannel): Promise<void> {
      await client.query(`LISTEN ${channel}`);
    },
    on(channel, handler) {
      emitter.on(channel, handler);
    },
    off(channel, handler) {
      emitter.off(channel, handler);
    },
    async close(): Promise<void> {
      await client.end();
    },
  };
}
