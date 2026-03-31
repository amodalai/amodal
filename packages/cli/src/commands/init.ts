/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {CommandModule} from 'yargs';
import {generateConfigTemplate} from '../templates/config-template.js';

export interface InitOptions {
  cwd?: string;
  name?: string;
  provider?: 'anthropic' | 'openai' | 'google';
}

/**
 * Scaffolds a new amodal project in the current directory.
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(cwd, 'amodal.json');

  if (existsSync(configPath)) {
    process.stderr.write('[init] amodal.json already exists. Skipping.\n');
    return;
  }

  const name = options.name || cwd.split('/').pop() || 'my-agent';
  const provider = options.provider ?? 'anthropic';

  // Create directory structure
  const dirs = [
    join(cwd, 'connections'),
    join(cwd, 'skills'),
    join(cwd, 'knowledge'),
    join(cwd, 'automations'),
    join(cwd, 'evals'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, {recursive: true});
  }

  // Write amodal.json at repo root
  writeFileSync(configPath, generateConfigTemplate({name, provider}));

  // Write .gitignore if it doesn't exist
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.amodal/\namodal_packages/\n.env\n.env.*\n');
  }

  process.stderr.write(`[init] Created project "${name}" (${provider})\n`);
  process.stderr.write('[init] Next steps:\n');
  process.stderr.write('  1. Add a connection:  amodal connect <name>\n');
  process.stderr.write('  2. Validate config:   amodal validate\n');
  process.stderr.write('  3. Start dev server:  amodal dev\n');
}

export const initCommand: CommandModule = {
  command: 'init',
  describe: 'Initialize a new amodal project',
  builder: (yargs) =>
    yargs
      .option('name', {
        type: 'string',
        describe: 'Project name (defaults to directory name)',
      })
      .option('provider', {
        type: 'string',
        choices: ['anthropic', 'openai', 'google'] as const,
        describe: 'LLM provider (default: anthropic)',
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const provider = argv['provider'] as InitOptions['provider'];
    await runInit({
      name: argv['name'] ? String(argv['name']) : undefined,
      provider,
    });
  },
};
