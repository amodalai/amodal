/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
import {connectCommand} from '../connect.js';
import {installPkgCommand} from '../install-pkg.js';
import {uninstallCommand} from '../uninstall.js';
import {listCommand} from '../list.js';
import {updateCommand} from '../update.js';
import {diffCommand} from '../diff.js';
import {searchCommand} from '../search.js';
import {publishCommand} from '../publish.js';
import {linkCommand} from '../link.js';
import {syncCommand} from '../sync.js';

export const pkgCommand: CommandModule = {
  command: 'pkg <command>',
  describe: 'Manage packages',
  builder: (yargs) =>
    yargs
      .command(connectCommand)
      .command(installPkgCommand)
      .command(uninstallCommand)
      .command(listCommand)
      .command(updateCommand)
      .command(diffCommand)
      .command(searchCommand)
      .command(publishCommand)
      .command(linkCommand)
      .command(syncCommand)
      .demandCommand(1, 'Specify a subcommand'),
  handler: () => {},
};
