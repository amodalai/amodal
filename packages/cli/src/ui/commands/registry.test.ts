/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {parseSlashCommand, getCommand, getAllCommands} from './index.js';

describe('parseSlashCommand', () => {
  it('returns null for non-command input', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('not a command')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });

  it('parses a simple command', () => {
    expect(parseSlashCommand('/help')).toEqual({name: 'help', args: ''});
  });

  it('parses a command with args', () => {
    expect(parseSlashCommand('/model gpt-4')).toEqual({
      name: 'model',
      args: 'gpt-4',
    });
  });

  it('trims whitespace', () => {
    expect(parseSlashCommand('  /help  ')).toEqual({name: 'help', args: ''});
  });

  it('handles multiple args', () => {
    expect(parseSlashCommand('/theme dark mode')).toEqual({
      name: 'theme',
      args: 'dark mode',
    });
  });
});

describe('getCommand', () => {
  it('finds registered commands by name', () => {
    const cmd = getCommand('help');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('help');
  });

  it('finds commands by alias', () => {
    const cmd = getCommand('h');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('help');
  });

  it('returns undefined for unknown commands', () => {
    expect(getCommand('nonexistent')).toBeUndefined();
  });
});

describe('getAllCommands', () => {
  it('returns all unique commands', () => {
    const commands = getAllCommands();
    expect(commands.length).toBeGreaterThanOrEqual(5);
    const names = commands.map((c) => c.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('stats');
    expect(names).toContain('model');
    expect(names).toContain('sessions');
  });

  it('does not include duplicates from aliases', () => {
    const commands = getAllCommands();
    const names = commands.map((c) => c.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });
});
