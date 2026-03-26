/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand} from './registry.js';
import type {CommandResult} from './registry.js';

registerCommand({
  name: 'sessions',
  description: 'Browse previous sessions (coming soon)',
  aliases: [],
  execute: (): CommandResult =>
    ({type: 'message', text: 'Session browser coming soon.'}),
});
