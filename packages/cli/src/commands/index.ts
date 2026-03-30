/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {initCommand} from './init.js';
import {devCommand} from './dev.js';
import {inspectCommand} from './inspect.js';
import {validateCommand} from './validate.js';
import {connectCommand} from './connect.js';
import {installPkgCommand} from './install-pkg.js';
import {uninstallCommand} from './uninstall.js';
import {listCommand} from './list.js';
import {updateCommand} from './update.js';
import {diffCommand} from './diff.js';
import {searchCommand} from './search.js';
import {publishCommand} from './publish.js';
import {loginCommand, logoutCommand} from './login.js';
import {linkCommand} from './link.js';
import {syncCommand} from './sync.js';
import {secretsCommand} from './secrets.js';
import {deployCommand} from './deploy.js';
import {buildCommand} from './build.js';
import {dockerCommand} from './docker.js';
import {rollbackCommand} from './rollback.js';
import {deploymentsCommand} from './deployments.js';
import {promoteCommand} from './promote.js';
import {serveCommand} from './serve.js';
import {statusCommand} from './status.js';
import {chatCommand} from './chat.js';
import {auditCommand} from './audit.js';
import {evalCommand} from './eval.js';
import {experimentCommand} from './experiment.js';
import {testQueryCommand} from './test-query.js';
import {automationsCommand} from './automations.js';

/**
 * All amodal subcommands for flat registration on the root yargs instance.
 */
export const amodalCommands = [
  // Project
  initCommand,
  devCommand,
  inspectCommand,
  validateCommand,
  // Package management
  connectCommand,
  installPkgCommand,
  uninstallCommand,
  listCommand,
  updateCommand,
  diffCommand,
  searchCommand,
  publishCommand,
  loginCommand,
  logoutCommand,
  linkCommand,
  syncCommand,
  // Platform
  secretsCommand,
  deployCommand,
  buildCommand,
  dockerCommand,
  rollbackCommand,
  deploymentsCommand,
  promoteCommand,
  serveCommand,
  statusCommand,
  chatCommand,
  auditCommand,
  automationsCommand,
  // Advanced
  evalCommand,
  experimentCommand,
  testQueryCommand,
];
