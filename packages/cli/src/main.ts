#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {amodalCommands} from './commands/index.js';

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
  .version(process.env['CLI_VERSION'] ?? '0.0.0')
  .alias('v', 'version');

void cli.parse();
