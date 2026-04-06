/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `amodal channels install <name>` — install a messaging channel plugin
 * and scaffold its config block in amodal.json.
 *
 * Usage:
 *   amodal channels install telegram
 */

import type {CommandModule} from 'yargs';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {ensurePackageJson, pmAdd} from '@amodalai/core';
// eslint-disable-next-line import/no-internal-modules -- shared utility
import {findRepoRoot} from '../shared/repo-discovery.js';

/** Default config scaffolds per channel type. */
const CONFIG_SCAFFOLDS: Record<string, Record<string, unknown>> = {
  telegram: {
    botToken: 'env:TELEGRAM_BOT_TOKEN',
    webhookSecret: 'env:TELEGRAM_WEBHOOK_SECRET',
    allowedUsers: ['env:TELEGRAM_OWNER_ID'],
  },
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- yargs CommandModule default generic
export const installChannelCommand: CommandModule<{}, {name: string}> = {
  command: 'install <name>',
  describe: 'Install a messaging channel plugin',
  builder: (yargs) =>
    yargs.positional('name', {
      describe: 'Channel name (e.g. telegram, slack)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    const channelName = argv.name;
    const npmName = `@amodalai/channel-${channelName}`;

    let repoPath: string;
    try {
      repoPath = findRepoRoot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[channels install] ${msg}\n`);
      process.exitCode = 1;
      return;
    }

    // Install the npm package
    process.stderr.write(`[channels install] Installing ${npmName}...\n`);
    try {
      ensurePackageJson(repoPath, 'amodal-project');
      await pmAdd(repoPath, npmName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[channels install] Failed to install ${npmName}: ${msg}\n`);
      process.exitCode = 1;
      return;
    }

    // Scaffold config block in amodal.json
    const configPath = path.join(repoPath, 'amodal.json');
    try {
      const raw = readFileSync(configPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
      const config = JSON.parse(raw) as Record<string, unknown>;

      // Add channels block if missing
      if (!config['channels'] || typeof config['channels'] !== 'object') {
        config['channels'] = {};
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by typeof check above
      const channels = config['channels'] as Record<string, unknown>;

      // Only scaffold if the channel isn't already configured
      if (!channels[channelName]) {
        channels[channelName] = CONFIG_SCAFFOLDS[channelName] ?? {};
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        process.stderr.write(`[channels install] Added channels.${channelName} to amodal.json\n`);
      } else {
        process.stderr.write(`[channels install] channels.${channelName} already exists in amodal.json\n`);
      }
    } catch {
      process.stderr.write(`[channels install] Could not update amodal.json — add the channels.${channelName} block manually.\n`);
    }

    // Print next steps
    process.stderr.write(`\n✅ ${npmName} installed.\n\nNext steps:\n`);
    process.stderr.write(`  1. Set environment variables (e.g. TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET)\n`);
    process.stderr.write(`  2. Run: amodal channels setup ${channelName} --url <your-webhook-url>\n`);
    process.stderr.write(`  3. Start the server: amodal dev\n\n`);
  },
};
