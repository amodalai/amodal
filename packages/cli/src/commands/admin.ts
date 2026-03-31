/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {
  fetchAdminAgent,
  getAdminAgentVersion,
  getAdminCacheDir,
  resolveAdminAgent,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

export const adminCommand: CommandModule = {
  command: 'admin <action>',
  describe: 'Manage the admin agent',
  builder: (yargs) =>
    yargs
      .command(
        'update',
        'Update the admin agent to the latest version from the registry',
        {},
        async () => {
          process.stderr.write('[admin] Fetching latest admin agent...\n');
          try {
            const dir = await fetchAdminAgent();
            const version = await getAdminAgentVersion(dir);
            process.stderr.write(`[admin] Updated to v${version ?? 'unknown'} at ${dir}\n`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[admin] Update failed: ${msg}\n`);
            process.exit(1);
          }
        },
      )
      .command(
        'status',
        'Show admin agent status and location',
        {},
        async () => {
          let repoPath: string | undefined;
          try {
            repoPath = findRepoRoot();
          } catch {
            // Not in a repo
          }

          const dir = await resolveAdminAgent(repoPath);
          if (!dir) {
            process.stderr.write('[admin] Admin agent not installed.\n');
            process.stderr.write('[admin] Run `amodal admin update` to fetch it.\n');
            return;
          }

          const version = await getAdminAgentVersion(dir);
          process.stderr.write(`[admin] Version: ${version ?? 'unknown'}\n`);
          process.stderr.write(`[admin] Location: ${dir}\n`);

          const cacheDir = getAdminCacheDir();
          if (dir === cacheDir) {
            process.stderr.write('[admin] Source: global cache\n');
          } else {
            process.stderr.write('[admin] Source: custom override\n');
          }
        },
      )
      .demandCommand(1, 'Specify an action: update, status'),
  handler: () => {
    // Handled by subcommands
  },
};
