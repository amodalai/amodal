/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findMissingEnvVars, parseEnvContent, readEnvFile, serializeEnvEntries, upsertEnvEntries} from './env-file.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe('parseEnvContent', () => {
  it('parses KEY=value pairs', () => {
    const result = parseEnvContent('FOO=bar\nBAZ=qux');
    expect(result.get('FOO')).toBe('bar');
    expect(result.get('BAZ')).toBe('qux');
  });

  it('handles quoted values', () => {
    const result = parseEnvContent('FOO="hello world"\nBAR=\'single quoted\'');
    expect(result.get('FOO')).toBe('hello world');
    expect(result.get('BAR')).toBe('single quoted');
  });

  it('skips comments', () => {
    const result = parseEnvContent('# comment\nFOO=bar\n# another comment');
    expect(result.size).toBe(1);
    expect(result.get('FOO')).toBe('bar');
  });

  it('skips empty lines', () => {
    const result = parseEnvContent('\nFOO=bar\n\nBAZ=qux\n');
    expect(result.size).toBe(2);
  });

  it('handles empty string value', () => {
    const result = parseEnvContent('FOO=');
    expect(result.get('FOO')).toBe('');
  });

  it('handles value with equals sign', () => {
    const result = parseEnvContent('FOO=bar=baz');
    expect(result.get('FOO')).toBe('bar=baz');
  });
});

describe('serializeEnvEntries', () => {
  it('serializes simple entries', () => {
    const entries = new Map([['FOO', 'bar'], ['BAZ', 'qux']]);
    const result = serializeEnvEntries(entries);
    expect(result).toBe('FOO=bar\nBAZ=qux\n');
  });

  it('quotes values with spaces', () => {
    const entries = new Map([['FOO', 'hello world']]);
    const result = serializeEnvEntries(entries);
    expect(result).toBe('FOO="hello world"\n');
  });

  it('returns empty string for empty map', () => {
    expect(serializeEnvEntries(new Map())).toBe('');
  });
});

describe('readEnvFile', () => {
  it('reads existing .env file', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'FOO=bar\nBAZ=qux\n');
    const result = await readEnvFile(envPath);
    expect(result.get('FOO')).toBe('bar');
    expect(result.get('BAZ')).toBe('qux');
  });

  it('returns empty map for missing file', async () => {
    const result = await readEnvFile(path.join(tmpDir, 'nonexistent'));
    expect(result.size).toBe(0);
  });
});

describe('upsertEnvEntries', () => {
  it('creates new file with entries', async () => {
    const envPath = path.join(tmpDir, '.env');
    await upsertEnvEntries(envPath, {FOO: 'bar', BAZ: 'qux'});
    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain('FOO=bar');
    expect(content).toContain('BAZ=qux');
  });

  it('updates existing entries in place', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, '# comment\nFOO=old\nBAZ=keep\n');
    await upsertEnvEntries(envPath, {FOO: 'new'});
    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain('# comment');
    expect(content).toContain('FOO=new');
    expect(content).toContain('BAZ=keep');
    expect(content).not.toContain('FOO=old');
  });

  it('appends new entries to existing file', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'EXISTING=yes\n');
    await upsertEnvEntries(envPath, {NEW_KEY: 'value'});
    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain('EXISTING=yes');
    expect(content).toContain('NEW_KEY=value');
  });

  it('preserves comments and blank lines', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, '# My config\n\nFOO=bar\n');
    await upsertEnvEntries(envPath, {FOO: 'updated'});
    const content = await readFile(envPath, 'utf-8');
    expect(content).toContain('# My config');
    expect(content).toContain('FOO=updated');
  });
});

describe('findMissingEnvVars', () => {
  it('finds missing vars', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'FOO=bar\n');
    const missing = await findMissingEnvVars(envPath, ['FOO', 'BAZ', 'QUX']);
    expect(missing).toEqual(['BAZ', 'QUX']);
  });

  it('returns all as missing when file does not exist', async () => {
    const missing = await findMissingEnvVars(path.join(tmpDir, 'nope'), ['A', 'B']);
    expect(missing).toEqual(['A', 'B']);
  });

  it('returns empty array when all vars present', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'A=1\nB=2\n');
    const missing = await findMissingEnvVars(envPath, ['A', 'B']);
    expect(missing).toEqual([]);
  });

  it('treats empty values as missing', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'A=\nB=value\n');
    const missing = await findMissingEnvVars(envPath, ['A', 'B']);
    expect(missing).toEqual(['A']);
  });
});
