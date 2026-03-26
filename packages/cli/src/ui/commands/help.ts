/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand, getAllCommands} from './registry.js';
import type {CommandResult} from './registry.js';

registerCommand({
  name: 'help',
  description: 'Show available commands and keyboard shortcuts',
  aliases: ['h', '?'],
  execute: (): CommandResult => {
    const commands = getAllCommands();
    const lines = [
      'Commands:',
      ...commands.map(
        (cmd) =>
          `  /${cmd.name}${cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => '/' + a).join(', ')})` : ''} — ${cmd.description}`,
      ),
      '',
      'Keyboard shortcuts:',
      '  j/k          Scroll down/up one line',
      '  PgUp/PgDn    Scroll one page',
      '  Home/End     Jump to top/bottom',
      '  Ctrl+C       Exit',
    ];
    return {type: 'message', text: lines.join('\n')};
  },
});
