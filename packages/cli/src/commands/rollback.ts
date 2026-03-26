/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {PlatformClient} from '../shared/platform-client.js';

export interface RollbackOptions {
  deployId?: string;
  prev?: boolean;
  env?: string;
}

/**
 * Rollback to a previous deployment.
 */
export async function runRollback(options: RollbackOptions = {}): Promise<number> {
  let client: PlatformClient;
  try {
    client = new PlatformClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[rollback] ${msg}\n`);
    return 1;
  }

  const environment = options.env ?? 'production';

  try {
    const result = await client.rollback({
      deployId: options.deployId,
      environment,
    });
    process.stderr.write(`[rollback] Rolled back to ${result.id} in ${result.environment}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[rollback] Failed: ${msg}\n`);
    return 1;
  }
}

export const rollbackCommand: CommandModule = {
  command: 'rollback [deploy-id]',
  describe: 'Rollback to a previous deployment',
  builder: (yargs) =>
    yargs
      .positional('deploy-id', {
        type: 'string',
        describe: 'Deploy ID to rollback to (omit for previous)',
      })
      .option('prev', {
        type: 'boolean',
        describe: 'Rollback to previous deployment',
        default: false,
      })
      .option('env', {
        type: 'string',
        describe: 'Target environment (default: production)',
      }),
  handler: async (argv) => {
    const code = await runRollback({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      deployId: argv['deployId'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: argv['env'] as string | undefined,
    });
    process.exit(code);
  },
};
