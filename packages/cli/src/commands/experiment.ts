/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {resolvePlatformConfig} from '../shared/platform-client.js';

export interface ExperimentOptions {
  action: 'create' | 'deploy' | 'watch' | 'list';
  name?: string;
  id?: string;
  platformUrl?: string;
  platformApiKey?: string;
  controlConfig?: string;
  variantConfig?: string;
}

/**
 * Manage model experiments via the platform API.
 */
export async function runExperimentCommand(options: ExperimentOptions): Promise<void> {
  let platformUrl: string;
  let apiKey: string;
  try {
    const config = await resolvePlatformConfig({
      url: options.platformUrl,
      apiKey: options.platformApiKey,
    });
    platformUrl = config.url;
    apiKey = config.apiKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[experiment] ${msg}\n`);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  switch (options.action) {
    case 'list': {
      const res = await fetch(`${platformUrl}/api/experiments`, {headers});
      if (!res.ok) {
        process.stderr.write(`[experiment] HTTP ${res.status}\n`);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
      const data = await res.json() as {experiments: Array<Record<string, unknown>>};
      if (data.experiments.length === 0) {
        process.stdout.write('No experiments found.\n');
        return;
      }
      for (const exp of data.experiments) {
        process.stdout.write(`${exp['id']}  ${exp['name']}  [${exp['status']}]\n`);
      }
      break;
    }

    case 'create': {
      if (!options.name) {
        process.stderr.write('[experiment] --name is required for create\n');
        return;
      }
      const controlConfig: Record<string, unknown> = options.controlConfig
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI JSON input
        ? JSON.parse(options.controlConfig) as Record<string, unknown>
        : {};
      const variantConfig: Record<string, unknown> = options.variantConfig
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI JSON input
        ? JSON.parse(options.variantConfig) as Record<string, unknown>
        : {};

      const res = await fetch(`${platformUrl}/api/experiments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({name: options.name, controlConfig, variantConfig}),
      });
      if (!res.ok) {
        process.stderr.write(`[experiment] HTTP ${res.status}\n`);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
      const {id} = await res.json() as {id: string};
      process.stdout.write(`Created experiment: ${id}\n`);
      break;
    }

    case 'deploy': {
      if (!options.id) {
        process.stderr.write('[experiment] --id is required for deploy\n');
        return;
      }
      const res = await fetch(`${platformUrl}/api/experiments/${options.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({status: 'deployed'}),
      });
      if (!res.ok) {
        process.stderr.write(`[experiment] HTTP ${res.status}\n`);
        return;
      }
      process.stdout.write(`Deployed experiment: ${options.id}\n`);
      break;
    }

    case 'watch': {
      if (!options.id) {
        process.stderr.write('[experiment] --id is required for watch\n');
        return;
      }
      const res = await fetch(`${platformUrl}/api/experiments/${options.id}`, {headers});
      if (!res.ok) {
        process.stderr.write(`[experiment] HTTP ${res.status}\n`);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
      const exp = await res.json() as Record<string, unknown>;
      process.stdout.write(JSON.stringify(exp, null, 2) + '\n');
      break;
    }

    default:
      process.stderr.write(`[experiment] Unknown action: ${options.action}\n`);
      break;
  }
}

export const experimentCommand: CommandModule = {
  command: 'experiment <action>',
  describe: 'Manage model experiments',
  builder: (yargs) =>
    yargs
      .positional('action', {
        type: 'string',
        demandOption: true,
        choices: ['create', 'deploy', 'watch', 'list'] as const,
      })
      .option('name', {type: 'string'})
      .option('id', {type: 'string'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- yargs parsed argv
    const opts = argv as unknown as ExperimentOptions;
    await runExperimentCommand({
      action: opts['action'],
      name: opts['name'],
      id: opts['id'],
    });
  },
};
