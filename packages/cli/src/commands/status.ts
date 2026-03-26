/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {PlatformClient} from '../shared/platform-client.js';

export interface StatusOptions {
  env?: string;
  json?: boolean;
}

/**
 * Show current deployment status per environment.
 */
export async function runStatus(options: StatusOptions = {}): Promise<number> {
  let client: PlatformClient;
  try {
    client = await PlatformClient.create();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[status] ${msg}\n`);
    return 1;
  }

  const environments = options.env ? [options.env] : ['production', 'staging'];

  try {
    const results: Array<{environment: string; id?: string; createdAt?: string; createdBy?: string; commitSha?: string}> = [];

    for (const env of environments) {
      const deployments = await client.listDeployments({environment: env, limit: 1});
      const active = deployments.find((d) => d.isActive);
      if (active) {
        results.push({
          environment: env,
          id: active.id,
          createdAt: active.createdAt,
          createdBy: active.createdBy ?? undefined,
          commitSha: active.commitSha ?? undefined,
        });
      } else {
        results.push({environment: env});
      }
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      return 0;
    }

    for (const r of results) {
      if (r.id) {
        const sha = r.commitSha ? ` (${r.commitSha.slice(0, 7)})` : '';
        process.stdout.write(`${r.environment}: ${r.id}${sha} — ${r.createdBy ?? 'unknown'} at ${r.createdAt}\n`);
      } else {
        process.stdout.write(`${r.environment}: no active deployment\n`);
      }
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[status] Failed: ${msg}\n`);
    return 1;
  }
}

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show current deployment status',
  builder: (yargs) =>
    yargs
      .option('env', {
        type: 'string',
        describe: 'Check specific environment',
      })
      .option('json', {
        type: 'boolean',
        describe: 'Output as JSON',
        default: false,
      }),
  handler: async (argv) => {
    const code = await runStatus({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: argv['env'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      json: argv['json'] as boolean | undefined,
    });
    process.exit(code);
  },
};
