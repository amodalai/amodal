#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFileSync} from 'node:fs';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {amodalCommands} from './commands/index.js';
import {loadEnvFile} from './shared/load-env.js';

// Load .env from current directory before anything else
loadEnvFile(process.cwd());

let pkgVersion = process.env['CLI_VERSION'] ?? '';
if (!pkgVersion) {
  try {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    if (raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'string') {
      pkgVersion = raw.version;
    }
  } catch {
    pkgVersion = '0.0.0-dev';
  }
}

const cli = yargs(hideBin(process.argv))
  .scriptName('amodal')
  .usage('$0 <command> [options]');

for (const cmd of amodalCommands) {
  cli.command(cmd);
}

cli
  .demandCommand(1, 'Run amodal <command> --help for usage')
  .strict()
  .help()
  .alias('h', 'help')
  .version(process.env['CLI_VERSION'] ?? pkgVersion)
  .alias('v', 'version');

void cli.parse();
