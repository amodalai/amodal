/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {CommandModule} from 'yargs';

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

import {amodalCommands} from './index.js';

function assertValidCommandModule(mod: CommandModule, expectedCommand: string): void {
  expect(mod.command).toBeDefined();
  expect(String(mod.command).split(' ')[0]).toBe(expectedCommand);
  expect(typeof mod.handler).toBe('function');
}

describe('command-exports', () => {
  it('top-level commands export valid CommandModules', () => {
    assertValidCommandModule(initCommand, 'init');
    assertValidCommandModule(devCommand, 'dev');
    assertValidCommandModule(chatCommand, 'chat');
    assertValidCommandModule(validateCommand, 'validate');
    assertValidCommandModule(inspectCommand, 'inspect');
    assertValidCommandModule(evalCommand, 'eval');
    assertValidCommandModule(testQueryCommand, 'test-query');
  });

  it('group commands export valid CommandModules', () => {
    assertValidCommandModule(pkgCommand, 'pkg');
    assertValidCommandModule(deployGroupCommand, 'deploy');
    assertValidCommandModule(opsCommand, 'ops');
    assertValidCommandModule(authCommand, 'auth');
  });

  it('amodalCommands has expected count', () => {
    expect(amodalCommands).toHaveLength(11);
  });
});
