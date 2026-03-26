/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {PlatformClient} from '../shared/platform-client.js';

export interface PromoteOptions {
  fromEnv: string;
  toEnv?: string;
}

/**
 * Promote a deployment from one environment to another.
 */
export async function runPromote(options: PromoteOptions): Promise<number> {
  let client: PlatformClient;
  try {
    client = new PlatformClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[promote] ${msg}\n`);
    return 1;
  }

  const toEnv = options.toEnv ?? 'production';

  try {
    const result = await client.promote(options.fromEnv, toEnv);
    process.stderr.write(`[promote] Promoted from ${options.fromEnv} to ${toEnv}: ${result.id}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[promote] Failed: ${msg}\n`);
    return 1;
  }
}

export const promoteCommand: CommandModule = {
  command: 'promote <from-env>',
  describe: 'Promote a deployment to production',
  builder: (yargs) =>
    yargs
      .positional('from-env', {
        type: 'string',
        demandOption: true,
        describe: 'Source environment to promote from',
      })
      .option('to', {
        type: 'string',
        describe: 'Target environment (default: production)',
      }),
  handler: async (argv) => {
    const code = await runPromote({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      fromEnv: argv['fromEnv'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      toEnv: argv['to'] as string | undefined,
    });
    process.exit(code);
  },
};
