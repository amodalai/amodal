/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {resolvePlatformConfig} from '../shared/platform-client.js';

export interface SecretsOptions {
  cwd?: string;
  subcommand: 'set' | 'list' | 'delete';
  key?: string;
  value?: string;
  json?: boolean;
}

/**
 * Manage platform secrets.
 * Returns 0 on success, 1 on error.
 */
export async function runSecrets(options: SecretsOptions): Promise<number> {
  let config: {url: string; apiKey: string};
  try {
    config = await resolvePlatformConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[secrets] ${msg}\n`);
    return 1;
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  switch (options.subcommand) {
    case 'set': {
      if (!options.key) {
        process.stderr.write('[secrets] Missing key. Usage: amodal secrets set <key> <value>\n');
        return 1;
      }
      if (options.value === undefined) {
        process.stderr.write('[secrets] Missing value. Usage: amodal secrets set <key> <value>\n');
        return 1;
      }

      try {
        const response = await fetch(`${config.url}/api/secrets`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({key: options.key, value: options.value}),
        });

        if (!response.ok) {
          process.stderr.write(`[secrets] Failed to set secret: ${response.status} ${response.statusText}\n`);
          return 1;
        }

        process.stderr.write(`[secrets] Secret "${options.key}" set successfully.\n`);
        return 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[secrets] Failed to set secret: ${msg}\n`);
        return 1;
      }
    }

    case 'list': {
      try {
        const response = await fetch(`${config.url}/api/secrets`, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          process.stderr.write(`[secrets] Failed to list secrets: ${response.status} ${response.statusText}\n`);
          return 1;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const secrets = (await response.json()) as Array<{key: string}>;

        if (secrets.length === 0) {
          process.stderr.write('[secrets] No secrets configured.\n');
          return 0;
        }

        if (options.json) {
          process.stdout.write(JSON.stringify(secrets, null, 2) + '\n');
          return 0;
        }

        process.stdout.write('KEY\n');
        for (const secret of secrets) {
          process.stdout.write(`${secret.key}\n`);
        }

        process.stderr.write(`[secrets] ${secrets.length} secret${secrets.length === 1 ? '' : 's'} configured.\n`);
        return 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[secrets] Failed to list secrets: ${msg}\n`);
        return 1;
      }
    }

    case 'delete': {
      if (!options.key) {
        process.stderr.write('[secrets] Missing key. Usage: amodal secrets delete <key>\n');
        return 1;
      }

      try {
        const response = await fetch(`${config.url}/api/secrets/${encodeURIComponent(options.key)}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          process.stderr.write(`[secrets] Failed to delete secret: ${response.status} ${response.statusText}\n`);
          return 1;
        }

        process.stderr.write(`[secrets] Secret "${options.key}" deleted.\n`);
        return 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[secrets] Failed to delete secret: ${msg}\n`);
        return 1;
      }
    }

    default:
      break;
  }

  return 1;
}

export const secretsCommand: CommandModule = {
  command: 'secrets <subcommand> [key] [value]',
  describe: 'Manage platform secrets',
  builder: (yargs) =>
    yargs
      .positional('subcommand', {type: 'string', demandOption: true, choices: ['set', 'list', 'delete'] as const, describe: 'Action'})
      .positional('key', {type: 'string', describe: 'Secret key'})
      .positional('value', {type: 'string', describe: 'Secret value (for set)'})
      .option('json', {type: 'boolean', default: false, describe: 'Output as JSON'}),
  handler: async (argv) => {
    const code = await runSecrets({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      subcommand: argv['subcommand'] as 'set' | 'list' | 'delete',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      key: argv['key'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      value: argv['value'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      json: argv['json'] as boolean,
    });
    process.exit(code);
  },
};
