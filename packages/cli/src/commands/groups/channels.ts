/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {installChannelCommand} from '../install-channel.js';

export const channelsCommand: CommandModule = {
  command: 'channels <command>',
  describe: 'Manage messaging channels',
  builder: (yargs) =>
    yargs
      .command(installChannelCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
