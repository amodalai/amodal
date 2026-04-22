/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {CommandModule} from 'yargs';
import {ensurePackageJson} from '@amodalai/core';
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

  // Ensure package.json exists
  ensurePackageJson(cwd, name);

  // Write .gitignore if it doesn't exist
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.amodal/\nnode_modules/\n.env\n.env.*\n');
  }

  // Write skeleton .env if it doesn't exist
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, generateEnvTemplate(provider));
  }

  process.stderr.write(`[init] Created project "${name}" (${provider})\n`);
  process.stderr.write('[init] Next steps:\n');
  process.stderr.write('  1. Add a connection:  amodal connect <name>\n');
  process.stderr.write('  2. Validate config:   amodal validate\n');
  process.stderr.write('  3. Start dev server:  amodal dev\n');
}

/**
 * Generates a skeleton .env with commented provider keys and common vars.
 * The selected provider's key is uncommented; others are commented out.
 */
function generateEnvTemplate(
  provider: 'anthropic' | 'openai' | 'google',
): string {
  const lines = [
    '# Amodal environment variables',
    '# Only fill in what you need — most projects use a single provider.',
    '# The runtime auto-detects your provider from whichever key is set.',
    '',
    '# LLM provider keys (uncomment the one you use)',
  ];

  const keys: Array<{key: string; provider: string}> = [
    {key: 'ANTHROPIC_API_KEY', provider: 'anthropic'},
    {key: 'OPENAI_API_KEY', provider: 'openai'},
    {key: 'GOOGLE_API_KEY', provider: 'google'},
  ];

  for (const {key, provider: p} of keys) {
    if (p === provider) {
      lines.push(`${key}=`);
    } else {
      lines.push(`# ${key}=`);
    }
  }

  lines.push(
    '',
    '# Database (required — Postgres connection for memory, stores, and sessions)',
    '# DATABASE_URL=postgresql://localhost:5432/my_agent',
    '',
  );

  return lines.join('\n');
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
