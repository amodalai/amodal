/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SandboxEscapeError } from './errors.js';

/**
 * Resolves a requested path within a sandbox directory, rejecting any
 * attempt to escape the sandbox. This is the single chokepoint for all
 * filesystem access in workspace tools.
 *
 * Security checks:
 * 1. Reject absolute paths
 * 2. Reject null bytes
 * 3. Reject '..' path segments
 * 4. Belt-and-suspenders: verify resolved path starts with sandbox root
 */
export function resolveSandboxPath(
  sandboxRoot: string,
  requestedPath: string,
): string {
  if (path.isAbsolute(requestedPath)) {
    throw new SandboxEscapeError(requestedPath, sandboxRoot);
  }

  if (requestedPath.includes('\0')) {
    throw new SandboxEscapeError(requestedPath, sandboxRoot);
  }

  // Check both Unix and Windows separators
  const segments = requestedPath.split(/[/\\]/);
  if (segments.includes('..')) {
    throw new SandboxEscapeError(requestedPath, sandboxRoot);
  }

  const resolved = path.resolve(sandboxRoot, requestedPath);

  if (resolved !== sandboxRoot && !resolved.startsWith(sandboxRoot + path.sep)) {
    throw new SandboxEscapeError(requestedPath, sandboxRoot);
  }

  return resolved;
}

/**
 * Validates that a path within the sandbox is not a symlink pointing
 * outside the sandbox. Uses lstat to check symlink targets.
 *
 * @returns The resolved path if safe
 * @throws SandboxEscapeError if the symlink target is outside the sandbox
 */
export async function validateNoSymlinkEscape(
  sandboxRoot: string,
  resolvedPath: string,
): Promise<string> {
  try {
    const lstatResult = await fs.lstat(resolvedPath);
    if (lstatResult.isSymbolicLink()) {
      const linkTarget = await fs.readlink(resolvedPath);
      const absoluteTarget = path.resolve(
        path.dirname(resolvedPath),
        linkTarget,
      );
      if (
        absoluteTarget !== sandboxRoot &&
        !absoluteTarget.startsWith(sandboxRoot + path.sep)
      ) {
        throw new SandboxEscapeError(resolvedPath, sandboxRoot);
      }
    }
  } catch (error: unknown) {
    if (error instanceof SandboxEscapeError) {
      throw error;
    }
    // File doesn't exist yet (ENOENT) — that's fine for write operations
    if (isNodeError(error) && error.code === 'ENOENT') {
      return resolvedPath;
    }
    throw error;
  }
  return resolvedPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
