/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {loginCommand, logoutCommand} from '../login.js';

export const authCommand: CommandModule = {
  command: 'auth <command>',
  describe: 'Authentication',
  builder: (yargs) =>
    yargs
      .command(loginCommand)
      .command(logoutCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
