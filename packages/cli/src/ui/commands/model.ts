/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand} from './registry.js';
import type {CommandResult} from './registry.js';
import type {ChatState} from '../types.js';

registerCommand({
  name: 'model',
  description: 'Show current model info',
  aliases: ['m'],
  execute: (_args: string, state: ChatState): CommandResult => {
    const model = state.tokenUsage.model ?? 'unknown';
    return {type: 'message', text: `Model: ${model}`};
  },
});
