/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SandboxEscapeError } from './errors.js';
import { resolveSandboxPath, validateNoSymlinkEscape } from './sandbox-path.js';

describe('resolveSandboxPath', () => {
  const sandboxRoot = '/tmp/amodal-workspace-test';

  it('resolves a valid relative path', () => {
    const result = resolveSandboxPath(sandboxRoot, 'foo/bar.txt');
    expect(result).toBe(path.join(sandboxRoot, 'foo/bar.txt'));
  });

  it('resolves a simple filename', () => {
    const result = resolveSandboxPath(sandboxRoot, 'file.txt');
    expect(result).toBe(path.join(sandboxRoot, 'file.txt'));
  });

  it('rejects absolute paths', () => {
    expect(() => resolveSandboxPath(sandboxRoot, '/etc/passwd')).toThrow(
      SandboxEscapeError,
    );
  });

  it('rejects null bytes', () => {
    expect(() =>
      resolveSandboxPath(sandboxRoot, 'foo\0bar.txt'),
    ).toThrow(SandboxEscapeError);
  });

  it('rejects .. segments', () => {
    expect(() => resolveSandboxPath(sandboxRoot, '../etc/passwd')).toThrow(
      SandboxEscapeError,
    );
  });

  it('rejects .. in the middle of a path', () => {
    expect(() =>
      resolveSandboxPath(sandboxRoot, 'foo/../../etc/passwd'),
    ).toThrow(SandboxEscapeError);
  });

  it('rejects .. at the end', () => {
    expect(() => resolveSandboxPath(sandboxRoot, 'foo/..')).toThrow(
      SandboxEscapeError,
    );
  });

  it('allows paths with dots that are not traversal', () => {
    const result = resolveSandboxPath(sandboxRoot, 'foo/.hidden/bar.txt');
    expect(result).toBe(path.join(sandboxRoot, 'foo/.hidden/bar.txt'));
  });

  it('allows dotfiles', () => {
    const result = resolveSandboxPath(sandboxRoot, '.gitignore');
    expect(result).toBe(path.join(sandboxRoot, '.gitignore'));
  });

  it('error includes context', () => {
    try {
      resolveSandboxPath(sandboxRoot, '/etc/passwd');
      expect.fail('should have thrown');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SandboxEscapeError);
      const e = error as SandboxEscapeError;
      expect(e.requestedPath).toBe('/etc/passwd');
      expect(e.sandboxRoot).toBe(sandboxRoot);
    }
  });
});

describe('validateNoSymlinkEscape', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows regular files', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    await fs.writeFile(filePath, 'hello');
    const result = await validateNoSymlinkEscape(tempDir, filePath);
    expect(result).toBe(filePath);
  });

  it('allows non-existent files (for writes)', async () => {
    const filePath = path.join(tempDir, 'new-file.txt');
    const result = await validateNoSymlinkEscape(tempDir, filePath);
    expect(result).toBe(filePath);
  });

  it('allows symlinks within sandbox', async () => {
    const target = path.join(tempDir, 'target.txt');
    await fs.writeFile(target, 'hello');
    const link = path.join(tempDir, 'link.txt');
    await fs.symlink(target, link);
    const result = await validateNoSymlinkEscape(tempDir, link);
    expect(result).toBe(link);
  });

  it('rejects symlinks pointing outside sandbox', async () => {
    const outsideTarget = path.join(os.tmpdir(), 'outside-target-' + Date.now());
    await fs.writeFile(outsideTarget, 'secret');
    const link = path.join(tempDir, 'evil-link.txt');
    await fs.symlink(outsideTarget, link);

    try {
      await expect(
        validateNoSymlinkEscape(tempDir, link),
      ).rejects.toThrow(SandboxEscapeError);
    } finally {
      await fs.rm(outsideTarget, { force: true });
    }
  });
});
