/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Import to register all commands
import './help.js';
import './clear.js';
import './stats.js';
import './model.js';
import './sessions.js';
import './theme.js';

// Re-export registry
export {
  parseSlashCommand,
  getCommand,
  getAllCommands,
  commandRegistry,
} from './registry.js';
export type {SlashCommand, CommandResult} from './registry.js';
