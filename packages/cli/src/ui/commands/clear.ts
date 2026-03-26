/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand} from './registry.js';
import type {CommandResult} from './registry.js';

registerCommand({
  name: 'clear',
  description: 'Clear conversation history',
  aliases: ['cls'],
  execute: (): CommandResult => ({type: 'clear'}),
});
