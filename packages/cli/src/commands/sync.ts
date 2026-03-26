/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {loadRepo,buildSyncPlan} from '@amodalai/core';
import type {SyncPlan} from '@amodalai/core';
import type {CommandModule} from 'yargs';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface SyncOptions {
  cwd?: string;
  /** CI mode — just check, exit 1 if drift detected */
  check?: boolean;
  /** Only sync a specific connection */
  connection?: string;
}

/**
 * For each connection with an OpenAPI spec URL, fetch the spec,
 * detect drift against the surface endpoints, and optionally
 * apply updates interactively.
 */
export async function runSync(options: SyncOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[sync] ${msg}\n`);
    return 1;
  }

  process.stderr.write(`[sync] Loading repo from ${repoPath}\n`);

  const repo = await loadRepo({localPath: repoPath});
  let hasDrift = false;

  for (const [name, conn] of repo.connections) {
    if (options.connection && name !== options.connection) {
      continue;
    }

    if (conn.spec.format !== 'openapi') {
      process.stderr.write(`[sync] ${name}: not an openapi connection (${conn.spec.format}), skipping\n`);
      continue;
    }

    process.stderr.write(`[sync] ${name}: checking for drift...\n`);

    try {
      const plan = await buildSyncPlan(conn);
      printSyncPlan(name, plan);

      if (plan.added.length > 0 || plan.removed.length > 0 || plan.changed.length > 0) {
        hasDrift = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[sync] ${name}: error — ${msg}\n`);
    }
  }

  if (options.check) {
    return hasDrift ? 1 : 0;
  }

  return 0;
}

function printSyncPlan(connectionName: string, plan: SyncPlan): void {
  const total = plan.added.length + plan.removed.length + plan.changed.length;

  if (total === 0) {
    process.stderr.write(`[sync] ${connectionName}: in sync (${plan.unchanged.length} endpoints)\n`);
    return;
  }

  process.stderr.write(`[sync] ${connectionName}: ${total} change(s) detected\n`);

  for (const ep of plan.added) {
    const label = 'method' in ep ? `${ep['method']} ${ep['path']}` : ep.name;
    process.stderr.write(`  + ${label}\n`);
  }

  for (const ep of plan.removed) {
    process.stderr.write(`  - ${ep.method} ${ep.path}\n`);
  }

  for (const change of plan.changed) {
    const label = 'endpoint' in change ? change['endpoint'] : change.name;
    process.stderr.write(`  ~ ${label} (${change.changes.join(', ')})\n`);
  }
}

export const syncCommand: CommandModule = {
  command: 'sync',
  describe: 'Check for OpenAPI spec drift',
  builder: {
    check: {
      type: 'boolean' as const,
      default: false,
      describe: 'CI mode — exit 1 if drift detected',
    },
    connection: {
      type: 'string' as const,
      describe: 'Only sync a specific connection',
    },
  },
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const check = argv['check'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const connection = argv['connection'] as string | undefined;
    const code = await runSync({check, connection});
    process.exit(code);
  },
};
