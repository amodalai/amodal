/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceError } from './errors.js';
import {
  editFile,
  globFiles,
  grepFiles,
  listFiles,
  readFile,
  writeFile,
} from './fs-tools.js';
import { Sandbox } from './sandbox.js';

describe('fs-tools', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await Sandbox.create('fs-test');

    // Set up test files
    await writeFile(sandbox, 'hello.txt', 'Hello, World!\nLine 2\nLine 3\n');
    await writeFile(sandbox, 'src/main.ts', 'const x = 1;\nconsole.log(x);\n');
    await writeFile(sandbox, 'src/util.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    await writeFile(sandbox, 'data/config.json', '{"key": "value"}\n');
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  describe('readFile', () => {
    it('reads full file content', async () => {
      const content = await readFile(sandbox, 'hello.txt');
      expect(content).toBe('Hello, World!\nLine 2\nLine 3\n');
    });

    it('reads with offset', async () => {
      const content = await readFile(sandbox, 'hello.txt', 1);
      expect(content).toBe('Line 2\nLine 3\n');
    });

    it('reads with offset and limit', async () => {
      const content = await readFile(sandbox, 'hello.txt', 1, 1);
      expect(content).toBe('Line 2');
    });

    it('throws on non-existent file', async () => {
      await expect(readFile(sandbox, 'nope.txt')).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('writes a new file', async () => {
      await writeFile(sandbox, 'new.txt', 'new content');
      const content = await readFile(sandbox, 'new.txt');
      expect(content).toBe('new content');
    });

    it('creates nested directories', async () => {
      await writeFile(sandbox, 'deep/nested/dir/file.txt', 'deep');
      const content = await readFile(sandbox, 'deep/nested/dir/file.txt');
      expect(content).toBe('deep');
    });

    it('overwrites existing file', async () => {
      await writeFile(sandbox, 'hello.txt', 'replaced');
      const content = await readFile(sandbox, 'hello.txt');
      expect(content).toBe('replaced');
    });
  });

  describe('editFile', () => {
    it('replaces text in file', async () => {
      const { occurrences } = await editFile(
        sandbox,
        'hello.txt',
        'World',
        'Universe',
      );
      expect(occurrences).toBe(1);
      const content = await readFile(sandbox, 'hello.txt');
      expect(content).toContain('Hello, Universe!');
    });

    it('replaces all occurrences', async () => {
      await writeFile(sandbox, 'repeat.txt', 'foo bar foo baz foo');
      const { occurrences } = await editFile(
        sandbox,
        'repeat.txt',
        'foo',
        'qux',
      );
      expect(occurrences).toBe(3);
      const content = await readFile(sandbox, 'repeat.txt');
      expect(content).toBe('qux bar qux baz qux');
    });

    it('throws when text not found', async () => {
      await expect(
        editFile(sandbox, 'hello.txt', 'nonexistent', 'replacement'),
      ).rejects.toThrow(WorkspaceError);
    });
  });

  describe('listFiles', () => {
    it('lists files in root', async () => {
      const files = await listFiles(sandbox);
      expect(files).toContain('hello.txt');
      expect(files).toContain('src/');
      expect(files).toContain('data/');
    });

    it('lists files in subdirectory', async () => {
      const files = await listFiles(sandbox, 'src');
      expect(files).toContain('src/main.ts');
      expect(files).toContain('src/util.ts');
    });

    it('lists recursively', async () => {
      const files = await listFiles(sandbox, undefined, true);
      expect(files).toContain('hello.txt');
      expect(files).toContain('src/main.ts');
      expect(files).toContain('src/util.ts');
      expect(files).toContain('data/config.json');
    });
  });

  describe('grepFiles', () => {
    it('finds matching lines', async () => {
      const matches = await grepFiles(sandbox, 'function');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].file).toBe('src/util.ts');
      expect(matches[0].line).toBe(1);
    });

    it('supports case insensitive search', async () => {
      const matches = await grepFiles(sandbox, 'hello', undefined, true);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('searches in subdirectory', async () => {
      const matches = await grepFiles(sandbox, 'const', 'src');
      expect(matches.length).toBe(1);
      expect(matches[0].file).toBe('src/main.ts');
    });

    it('returns empty for no matches', async () => {
      const matches = await grepFiles(sandbox, 'zzzznonexistent');
      expect(matches).toHaveLength(0);
    });
  });

  describe('globFiles', () => {
    it('matches by extension', async () => {
      const files = await globFiles(sandbox, '**/*.ts');
      expect(files).toContain('src/main.ts');
      expect(files).toContain('src/util.ts');
      expect(files).not.toContain('hello.txt');
    });

    it('matches by directory', async () => {
      const files = await globFiles(sandbox, 'src/*');
      expect(files).toContain('src/main.ts');
      expect(files).not.toContain('hello.txt');
    });

    it('matches specific file', async () => {
      const files = await globFiles(sandbox, 'hello.txt');
      expect(files).toEqual(['hello.txt']);
    });

    it('matches json files', async () => {
      const files = await globFiles(sandbox, '**/*.json');
      expect(files).toContain('data/config.json');
    });
  });
});
