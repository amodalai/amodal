/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {initCommand} from './init.js';
import {devCommand} from './dev.js';
import {inspectCommand} from './inspect.js';
import {validateCommand} from './validate.js';
import {chatCommand} from './chat.js';
import {evalCommand} from './eval.js';
import {testQueryCommand} from './test-query.js';
import {pkgCommand} from './groups/pkg.js';
import {deployGroupCommand} from './groups/deploy.js';
import {opsCommand} from './groups/ops.js';
import {authCommand} from './groups/auth.js';

/**
 * All amodal subcommands registered on the root yargs instance.
 *
 * Top-level: daily-driver commands (init, dev, chat, validate, inspect, eval, test)
 * Groups: pkg, deploy, ops, auth
 */
export const amodalCommands = [
  // Top-level
  initCommand,
  devCommand,
  chatCommand,
  validateCommand,
  inspectCommand,
  evalCommand,
  testQueryCommand,
  // Groups
  pkgCommand,
  deployGroupCommand,
  opsCommand,
  authCommand,
];
