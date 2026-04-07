/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {installPkgCommand} from '../install-pkg.js';
import {uninstallCommand} from '../uninstall.js';
import {linkCommand} from '../link.js';
import {syncCommand} from '../sync.js';

export const pkgCommand: CommandModule = {
  command: 'pkg <command>',
  describe: 'Manage packages',
  builder: (yargs) =>
    yargs
      .command(installPkgCommand)
      .command(uninstallCommand)
      .command(linkCommand)
      .command(syncCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
