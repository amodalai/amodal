/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {deployCommand as pushCommand} from '../deploy.js';
import {buildCommand} from '../build.js';
import {serveCommand} from '../serve.js';
import {statusCommand} from '../status.js';
import {deploymentsCommand} from '../deployments.js';
import {rollbackCommand} from '../rollback.js';
import {promoteCommand} from '../promote.js';

export const deployGroupCommand: CommandModule = {
  command: 'deploy <command>',
  describe: 'Deployment lifecycle',
  builder: (yargs) =>
    yargs
      .command(pushCommand)
      .command(buildCommand)
      .command(serveCommand)
      .command(statusCommand)
      .command(deploymentsCommand)
      .command(rollbackCommand)
      .command(promoteCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
