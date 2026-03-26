/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand} from './registry.js';
import type {CommandResult} from './registry.js';
import {
  setCurrentTheme,
  getCurrentThemeName,
  getAvailableThemes,
} from '../themes/index.js';

registerCommand({
  name: 'theme',
  description: 'Switch theme (/theme [name])',
  aliases: [],
  execute: (args: string): CommandResult => {
    if (!args) {
      const current = getCurrentThemeName();
      const available = getAvailableThemes();
      return {
        type: 'message',
        text: `Current theme: ${current}\nAvailable: ${available.join(', ')}`,
      };
    }
    const success = setCurrentTheme(args);
    if (success) {
      return {
        type: 'message',
        text: `Theme changed to "${args}". Restart chat to apply.`,
      };
    }
    const available = getAvailableThemes();
    return {
      type: 'message',
      text: `Unknown theme "${args}". Available: ${available.join(', ')}`,
    };
  },
});
