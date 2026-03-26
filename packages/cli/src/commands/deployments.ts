/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {PlatformClient} from '../shared/platform-client.js';

export interface DeploymentsOptions {
  env?: string;
  limit?: number;
  json?: boolean;
}

/**
 * List deployment history.
 */
export async function runDeployments(options: DeploymentsOptions = {}): Promise<number> {
  let client: PlatformClient;
  try {
    client = new PlatformClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deployments] ${msg}\n`);
    return 1;
  }

  try {
    const deployments = await client.listDeployments({
      environment: options.env,
      limit: options.limit ?? 10,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(deployments, null, 2) + '\n');
      return 0;
    }

    if (deployments.length === 0) {
      process.stderr.write('[deployments] No deployments found.\n');
      return 0;
    }

    for (const d of deployments) {
      const active = d.isActive ? ' [ACTIVE]' : '';
      const msg = d.message ? ` — ${d.message}` : '';
      const sha = d.commitSha ? ` (${d.commitSha.slice(0, 7)})` : '';
      process.stdout.write(`${d.id}  ${d.environment}${active}  ${d.createdBy ?? d.source}${sha}  ${d.createdAt}${msg}\n`);
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deployments] Failed: ${msg}\n`);
    return 1;
  }
}

export const deploymentsCommand: CommandModule = {
  command: 'deployments',
  describe: 'List deployment history',
  builder: (yargs) =>
    yargs
      .option('env', {
        type: 'string',
        describe: 'Filter by environment',
      })
      .option('limit', {
        type: 'number',
        describe: 'Number of deployments to show',
        default: 10,
      })
      .option('json', {
        type: 'boolean',
        describe: 'Output as JSON',
        default: false,
      }),
  handler: async (argv) => {
    const code = await runDeployments({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: argv['env'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      limit: argv['limit'] as number | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      json: argv['json'] as boolean | undefined,
    });
    process.exit(code);
  },
};
