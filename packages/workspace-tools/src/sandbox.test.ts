/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SandboxEscapeError, WorkspaceError } from './errors.js';
import { Sandbox } from './sandbox.js';

describe('Sandbox', () => {
  const sandboxes: Sandbox[] = [];

  afterEach(async () => {
    for (const sandbox of sandboxes) {
      await sandbox.cleanup();
    }
    sandboxes.length = 0;
  });

  async function createSandbox(): Promise<Sandbox> {
    const sandbox = await Sandbox.create('test-session');
    sandboxes.push(sandbox);
    return sandbox;
  }

  describe('create', () => {
    it('creates a temp directory', async () => {
      const sandbox = await createSandbox();
      const root = sandbox.getRoot();
      expect(root).toContain('amodal-workspace-test-session-');
      const stat = await fs.stat(root);
      expect(stat.isDirectory()).toBe(true);
    });

    it('creates unique directories per call', async () => {
      const s1 = await createSandbox();
      const s2 = await createSandbox();
      expect(s1.getRoot()).not.toBe(s2.getRoot());
    });
  });

  describe('resolvePath', () => {
    it('resolves a valid relative path', async () => {
      const sandbox = await createSandbox();
      const resolved = await sandbox.resolvePath('foo/bar.txt');
      expect(resolved).toBe(path.join(sandbox.getRoot(), 'foo/bar.txt'));
    });

    it('rejects path traversal', async () => {
      const sandbox = await createSandbox();
      await expect(sandbox.resolvePath('../escape')).rejects.toThrow(
        SandboxEscapeError,
      );
    });

    it('rejects absolute paths', async () => {
      const sandbox = await createSandbox();
      await expect(sandbox.resolvePath('/etc/passwd')).rejects.toThrow(
        SandboxEscapeError,
      );
    });
  });

  describe('manifest', () => {
    it('stashes and retrieves manifest', async () => {
      const sandbox = await createSandbox();
      sandbox.stashManifest([
        { path: 'a.txt', content: 'hello' },
        { path: 'b.txt', content: 'world' },
      ]);
      const manifest = sandbox.getManifest();
      expect(manifest.size).toBe(2);
      expect(manifest.has('a.txt')).toBe(true);
      expect(manifest.has('b.txt')).toBe(true);
    });

    it('throws if no manifest stashed', async () => {
      const sandbox = await createSandbox();
      expect(() => sandbox.getManifest()).toThrow(WorkspaceError);
    });

    it('hashes content deterministically', async () => {
      const sandbox = await createSandbox();
      sandbox.stashManifest([{ path: 'a.txt', content: 'hello' }]);
      const m1 = sandbox.getManifest();

      const sandbox2 = await createSandbox();
      sandbox2.stashManifest([{ path: 'a.txt', content: 'hello' }]);
      const m2 = sandbox2.getManifest();

      expect(m1.get('a.txt')).toBe(m2.get('a.txt'));
    });

    it('different content produces different hashes', async () => {
      const sandbox = await createSandbox();
      sandbox.stashManifest([
        { path: 'a.txt', content: 'hello' },
        { path: 'b.txt', content: 'world' },
      ]);
      const manifest = sandbox.getManifest();
      expect(manifest.get('a.txt')).not.toBe(manifest.get('b.txt'));
    });
  });

  describe('cleanup', () => {
    it('removes the sandbox directory', async () => {
      const sandbox = await Sandbox.create('cleanup-test');
      const root = sandbox.getRoot();
      await fs.writeFile(path.join(root, 'test.txt'), 'data');
      await sandbox.cleanup();

      await expect(fs.stat(root)).rejects.toThrow();
    });
  });
});
