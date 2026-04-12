/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { WorkspaceError } from './errors.js';
import type { Sandbox } from './sandbox.js';

/**
 * Reads a file from the sandbox with optional offset and limit for pagination.
 */
export async function readFile(
  sandbox: Sandbox,
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const resolved = await sandbox.resolvePath(filePath);
  const content = await fs.readFile(resolved, 'utf-8');

  if (offset !== undefined || limit !== undefined) {
    const lines = content.split('\n');
    const start = offset ?? 0;
    const end = limit !== undefined ? start + limit : lines.length;
    return lines.slice(start, end).join('\n');
  }

  return content;
}

/**
 * Writes a file to the sandbox, creating parent directories as needed.
 */
export async function writeFile(
  sandbox: Sandbox,
  filePath: string,
  content: string,
): Promise<void> {
  const resolved = await sandbox.resolvePath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
}

/**
 * Performs a find-and-replace edit on a file within the sandbox.
 */
export async function editFile(
  sandbox: Sandbox,
  filePath: string,
  oldText: string,
  newText: string,
): Promise<{ occurrences: number }> {
  const resolved = await sandbox.resolvePath(filePath);
  const content = await fs.readFile(resolved, 'utf-8');

  if (!content.includes(oldText)) {
    throw new WorkspaceError(
      'edit_file',
      `Text not found in file "${filePath}": "${oldText.slice(0, 100)}"`,
    );
  }

  // Count occurrences
  let occurrences = 0;
  let searchFrom = 0;
  while (true) {
    const idx = content.indexOf(oldText, searchFrom);
    if (idx === -1) break;
    occurrences++;
    searchFrom = idx + oldText.length;
  }

  const updated = content.replaceAll(oldText, newText);
  await fs.writeFile(resolved, updated, 'utf-8');

  return { occurrences };
}

/**
 * Lists files in the sandbox directory.
 */
export async function listFiles(
  sandbox: Sandbox,
  dir?: string,
  recursive?: boolean,
): Promise<string[]> {
  const resolved = dir !== undefined
    ? await sandbox.resolvePath(dir)
    : sandbox.getRoot();

  if (recursive) {
    return walkDir(resolved, sandbox.getRoot());
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries.map((entry) => {
    const relativePath = path.relative(
      sandbox.getRoot(),
      path.join(resolved, entry.name),
    );
    return entry.isDirectory() ? relativePath + '/' : relativePath;
  });
}

async function walkDir(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      results.push(relativePath + '/');
      const subResults = await walkDir(fullPath, root);
      results.push(...subResults);
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Searches files in the sandbox using a regex pattern.
 */
export async function grepFiles(
  sandbox: Sandbox,
  pattern: string,
  dir?: string,
  caseInsensitive?: boolean,
): Promise<Array<{ file: string; line: number; content: string }>> {
  const searchRoot = dir !== undefined
    ? await sandbox.resolvePath(dir)
    : sandbox.getRoot();

  const flags = caseInsensitive ? 'i' : '';
  const regex = new RegExp(pattern, flags);

  const files = await walkDir(searchRoot, sandbox.getRoot());
  const matches: Array<{ file: string; line: number; content: string }> = [];

  for (const relativePath of files) {
    // Skip directories
    if (relativePath.endsWith('/')) continue;

    const fullPath = path.join(sandbox.getRoot(), relativePath);
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const errWithCode = err as { code: unknown };
        if (errWithCode.code === 'ENOENT' || errWithCode.code === 'EISDIR' || errWithCode.code === 'EACCES') {
          continue;
        }
      }
      throw err;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({
          file: relativePath,
          line: i + 1,
          content: lines[i],
        });
      }
    }
  }

  return matches;
}

const GLOB_STAR = '<<GLOB_STAR>>';
const GLOB_DOUBLE_STAR = '<<GLOB_DOUBLE_STAR>>';

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\*\*/g, GLOB_DOUBLE_STAR)
    .replace(/\*/g, GLOB_STAR)
    .replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
    .replaceAll(GLOB_DOUBLE_STAR, '.*')
    .replaceAll(GLOB_STAR, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Matches files in the sandbox against a glob-like pattern.
 * Supports * (any chars except /) and ** (any path segments).
 */
export async function globFiles(
  sandbox: Sandbox,
  pattern: string,
): Promise<string[]> {
  const allFiles = await walkDir(sandbox.getRoot(), sandbox.getRoot());

  const regex = globToRegex(pattern);

  return allFiles.filter(
    (file) => !file.endsWith('/') && regex.test(file),
  );
}
