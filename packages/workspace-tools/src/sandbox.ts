/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { WorkspaceError } from './errors.js';
import { resolveSandboxPath, validateNoSymlinkEscape } from './sandbox-path.js';
import type { WorkspaceManifest } from './types.js';

const SANDBOX_PREFIX = 'amodal-workspace-';
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Manages a per-session temporary directory for workspace file operations.
 * All filesystem access is sandboxed to prevent path traversal attacks.
 */
export class Sandbox {
  private readonly root: string;
  private manifest: Map<string, string> | undefined;

  private constructor(root: string) {
    this.root = root;
  }

  /**
   * Creates a new sandbox directory for the given session.
   * @param sessionId - Session identifier used in the directory name
   * @param tmpDir - Base temp directory (caller provides to avoid direct os.tmpdir() usage)
   */
  static async create(sessionId: string, tmpDir?: string): Promise<Sandbox> {
    const uuid = crypto.randomUUID();
    const dirName = `${SANDBOX_PREFIX}${sessionId}-${uuid}`;
    const baseDir = tmpDir ?? '/tmp';
    const root = path.join(baseDir, dirName);
    await fs.mkdir(root, { recursive: true });
    return new Sandbox(root);
  }

  /**
   * Returns the sandbox root directory path.
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Resolves and validates a path within the sandbox.
   * Rejects path traversal, absolute paths, null bytes, and symlinks escaping the sandbox.
   */
  async resolvePath(requestedPath: string): Promise<string> {
    const resolved = resolveSandboxPath(this.root, requestedPath);
    return validateNoSymlinkEscape(this.root, resolved);
  }

  /**
   * Stores the original file manifest for later diffing.
   * The manifest maps relative paths to SHA-256 content hashes.
   */
  stashManifest(files: ReadonlyArray<{ path: string; content: string }>): void {
    const manifest = new Map<string, string>();
    for (const file of files) {
      const hash = crypto
        .createHash('sha256')
        .update(file.content)
        .digest('hex');
      manifest.set(file.path, hash);
    }
    this.manifest = manifest;
  }

  /**
   * Retrieves the stashed manifest.
   * @throws WorkspaceError if no manifest has been stashed
   */
  getManifest(): WorkspaceManifest {
    if (this.manifest === undefined) {
      throw new WorkspaceError(
        'get_manifest',
        'No manifest stashed. Call fetchWorkspace before submitDiff.',
      );
    }
    return this.manifest;
  }

  /**
   * Removes the sandbox directory and all its contents.
   */
  async cleanup(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }

  /**
   * Deletes any stale sandbox directories in the given temp directory
   * that are older than 2 hours.
   * @param tmpDir - Base temp directory to scan (caller provides to avoid direct os.tmpdir() usage)
   */
  static async sweepStale(tmpDir: string): Promise<number> {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    const now = Date.now();
    let cleaned = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(SANDBOX_PREFIX)) {
        continue;
      }

      const dirPath = path.join(tmpDir, entry.name);
      const stat = await fs.stat(dirPath);
      if (now - stat.mtimeMs > STALE_THRESHOLD_MS) {
        await fs.rm(dirPath, { recursive: true, force: true });
        cleaned++;
      }
    }

    return cleaned;
  }
}
