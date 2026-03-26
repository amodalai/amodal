/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {CommandModule} from 'yargs';

import {connectCommand} from './connect.js';
import {installPkgCommand} from './install-pkg.js';
import {uninstallCommand} from './uninstall.js';
import {listCommand} from './list.js';
import {updateCommand} from './update.js';
import {diffCommand} from './diff.js';
import {searchCommand} from './search.js';
import {publishCommand} from './publish.js';
import {loginCommand} from './login.js';
import {syncCommand} from './sync.js';

import {initCommand} from './init.js';
import {devCommand} from './dev.js';
import {inspectCommand} from './inspect.js';
import {validateCommand} from './validate.js';

import {secretsCommand} from './secrets.js';
import {deployCommand} from './deploy.js';
import {buildCommand} from './build.js';
import {dockerCommand} from './docker.js';
import {rollbackCommand} from './rollback.js';
import {deploymentsCommand} from './deployments.js';
import {promoteCommand} from './promote.js';
import {serveCommand} from './serve.js';
import {statusCommand} from './status.js';
import {auditCommand} from './audit.js';
import {automationsCommand} from './automations.js';

import {evalCommand} from './eval.js';
import {experimentCommand} from './experiment.js';
import {testQueryCommand} from './test-query.js';

function assertValidCommandModule(mod: CommandModule, expectedCommand: string): void {
  expect(mod.command).toBeDefined();
  expect(String(mod.command).split(' ')[0]).toBe(expectedCommand);
  expect(typeof mod.handler).toBe('function');
}

describe('command-exports', () => {
  it('package management commands export valid CommandModules', () => {
    assertValidCommandModule(connectCommand, 'connect');
    assertValidCommandModule(installPkgCommand, 'install');
    assertValidCommandModule(uninstallCommand, 'uninstall');
    assertValidCommandModule(listCommand, 'list');
    assertValidCommandModule(updateCommand, 'update');
    assertValidCommandModule(diffCommand, 'diff');
    assertValidCommandModule(searchCommand, 'search');
    assertValidCommandModule(publishCommand, 'publish');
    assertValidCommandModule(loginCommand, 'login');
    assertValidCommandModule(syncCommand, 'sync');
  });

  it('project commands export valid CommandModules', () => {
    assertValidCommandModule(initCommand, 'init');
    assertValidCommandModule(devCommand, 'dev');
    assertValidCommandModule(inspectCommand, 'inspect');
    assertValidCommandModule(validateCommand, 'validate');
  });

  it('platform commands export valid CommandModules', () => {
    assertValidCommandModule(secretsCommand, 'secrets');
    assertValidCommandModule(deployCommand, 'deploy');
    assertValidCommandModule(buildCommand, 'build');
    assertValidCommandModule(dockerCommand, 'docker');
    assertValidCommandModule(rollbackCommand, 'rollback');
    assertValidCommandModule(deploymentsCommand, 'deployments');
    assertValidCommandModule(promoteCommand, 'promote');
    assertValidCommandModule(serveCommand, 'serve');
    assertValidCommandModule(statusCommand, 'status');
    assertValidCommandModule(auditCommand, 'audit');
    assertValidCommandModule(automationsCommand, 'automations');
  });

  it('advanced commands export valid CommandModules', () => {
    assertValidCommandModule(evalCommand, 'eval');
    assertValidCommandModule(experimentCommand, 'experiment');
    assertValidCommandModule(testQueryCommand, 'test-query');
  });
});
