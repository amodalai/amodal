/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {secretsCommand} from '../secrets.js';
import {dockerCommand} from '../docker.js';
import {automationsCommand} from '../automations.js';
import {auditCommand} from '../audit.js';
import {experimentCommand} from '../experiment.js';

export const opsCommand: CommandModule = {
  command: 'ops <command>',
  describe: 'Platform operations',
  builder: (yargs) =>
    yargs
      .command(secretsCommand)
      .command(dockerCommand)
      .command(automationsCommand)
      .command(auditCommand)
      .command(experimentCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
