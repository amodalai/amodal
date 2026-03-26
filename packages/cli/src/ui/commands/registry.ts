/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ChatState} from '../types.js';

export interface CommandResult {
  type: 'message' | 'clear' | 'noop';
  text?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  aliases: string[];
  execute: (args: string, state: ChatState) => CommandResult;
}

const commands = new Map<string, SlashCommand>();

export function registerCommand(command: SlashCommand): void {
  commands.set(command.name, command);
  for (const alias of command.aliases) {
    commands.set(alias, command);
  }
}

export function getCommand(name: string): SlashCommand | undefined {
  return commands.get(name);
}

export function getAllCommands(): SlashCommand[] {
  const seen = new Set<string>();
  const result: SlashCommand[] = [];
  for (const cmd of commands.values()) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      result.push(cmd);
    }
  }
  return result;
}

/**
 * Parse a slash command from user input.
 * Returns null if the input is not a slash command.
 */
export function parseSlashCommand(
  input: string,
): {name: string; args: string} | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return {name: trimmed.slice(1), args: ''};
  }
  return {
    name: trimmed.slice(1, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export {commands as commandRegistry};
