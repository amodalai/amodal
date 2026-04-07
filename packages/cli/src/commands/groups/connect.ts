/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {connectConnectionCommand} from '../connect.js';
import {connectChannelCommand} from '../connect-channel.js';

export const connectGroupCommand: CommandModule = {
  command: 'connect <command>',
  describe: 'Connect a package (connection or channel)',
  builder: (yargs) =>
    yargs
      .command(connectConnectionCommand)
      .command(connectChannelCommand)
      .demandCommand(1, 'Specify: connection or channel'),
  handler: () => {},
};
