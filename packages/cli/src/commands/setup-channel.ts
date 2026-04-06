/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `amodal channels setup <name>` — register the webhook with the
 * messaging platform.
 *
 * For Telegram: calls the setWebhook API to register the URL where
 * Telegram should send updates.
 *
 * Usage:
 *   amodal channels setup telegram --url https://example.com/channels/telegram/webhook
 */

import type {CommandModule} from 'yargs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line import/no-internal-modules -- shared utility
import {findRepoRoot} from '../shared/repo-discovery.js';

const ENV_PREFIX = 'env:';

function resolveEnv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith(ENV_PREFIX)) {
    return process.env[value.slice(ENV_PREFIX.length)];
  }
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- yargs CommandModule default generic
export const setupChannelCommand: CommandModule<{}, {name: string; url: string}> = {
  command: 'setup <name>',
  describe: 'Register webhook with the messaging platform',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'Channel name (e.g. telegram)',
        type: 'string',
        demandOption: true,
      })
      .option('url', {
        describe: 'Public webhook URL (e.g. https://example.com/channels/telegram/webhook)',
        type: 'string',
        demandOption: true,
      }),
  handler: async (argv) => {
    const channelName = argv.name;
    const webhookUrl = argv.url;

    let repoPath: string;
    try {
      repoPath = findRepoRoot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[channels setup] ${msg}\n`);
      process.exitCode = 1;
      return;
    }

    // Read channel config from amodal.json
    const configPath = path.join(repoPath, 'amodal.json');
    let channelConfig: Record<string, unknown>;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
      const config = JSON.parse(raw) as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowing config field
      const channels = config['channels'] as Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowing channel config
      channelConfig = (channels?.[channelName] ?? {}) as Record<string, unknown>;
    } catch {
      process.stderr.write(`[channels setup] Could not read amodal.json\n`);
      process.exitCode = 1;
      return;
    }

    if (channelName === 'telegram') {
      await setupTelegram(channelConfig, webhookUrl);
    } else {
      process.stderr.write(`[channels setup] Setup for "${channelName}" is not yet supported.\n`);
      process.exitCode = 1;
    }
  },
};

async function setupTelegram(config: Record<string, unknown>, webhookUrl: string): Promise<void> {
  const botToken = resolveEnv(config['botToken']);
  if (!botToken) {
    process.stderr.write('[channels setup] TELEGRAM_BOT_TOKEN is not set. Set the env var and retry.\n');
    process.exitCode = 1;
    return;
  }

  const webhookSecret = resolveEnv(config['webhookSecret']);

  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const body: Record<string, unknown> = {url: webhookUrl};
  if (webhookSecret) {
    body['secret_token'] = webhookSecret;
  }

  process.stderr.write(`[channels setup] Registering webhook: ${webhookUrl}\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing Telegram API response
    const result = await response.json() as {ok: boolean; description?: string};
    if (result.ok) {
      process.stderr.write(`✅ Telegram webhook registered successfully.\n`);
    } else {
      process.stderr.write(`❌ Telegram API error: ${result.description ?? 'unknown error'}\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`❌ Failed to call Telegram API: ${msg}\n`);
    process.exitCode = 1;
  }
}
