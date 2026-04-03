/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin file tools rewritten for the new ToolRegistry (Phase 2.6).
 *
 * Four tools for managing agent repo files:
 * - read_repo_file    — read a file from the agent repo
 * - write_repo_file   — create or update a file
 * - delete_repo_file  — delete a file
 * - internal_api      — query the runtime's own API
 *
 * Path validation enforces allowed directories and blocks sensitive files.
 */

import {readFile, writeFile, unlink, mkdir} from 'node:fs/promises';
import * as path from 'node:path';
import {z} from 'zod';
import {ConfigError} from '../errors.js';
import type {ToolDefinition, ToolContext, ToolRegistry} from './types.js';

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

const ALLOWED_REPO_DIRS = [
  'skills/',
  'knowledge/',
  'connections/',
  'stores/',
  'pages/',
  'automations/',
  'evals/',
  'agents/',
  'tools/',
  'amodal_packages/',
];

const BLOCKED_FILENAMES = [
  '.env',
  'amodal.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
];

const READ_ONLY_DIRS = [
  'amodal_packages/',
];

/** @internal Exported for testing */
export function isAllowedRepoPath(relPath: string): boolean {
  const basename = path.basename(relPath);
  if (BLOCKED_FILENAMES.includes(basename)) return false;
  return ALLOWED_REPO_DIRS.some((dir) => relPath.startsWith(dir));
}

function isReadOnlyPath(relPath: string): boolean {
  return READ_ONLY_DIRS.some((dir) => relPath.startsWith(dir));
}

function validatePath(
  repoRoot: string,
  rawPath: string,
): {error: string} | {resolved: string; relative: string} {
  if (!rawPath || rawPath.startsWith('/')) {
    return {error: 'Path must be relative to the repo root (no leading /)'};
  }
  if (rawPath.includes('..')) {
    return {error: 'Path traversal (..) is not allowed'};
  }

  const normalized = path.normalize(rawPath);
  if (!isAllowedRepoPath(normalized)) {
    return {error: `Path "${normalized}" is not in an allowed directory. Allowed: ${ALLOWED_REPO_DIRS.join(', ')}. Blocked files: ${BLOCKED_FILENAMES.join(', ')}`};
  }

  const resolved = path.resolve(repoRoot, normalized);
  if (!resolved.startsWith(repoRoot)) {
    return {error: 'Resolved path escapes the repo directory'};
  }

  return {resolved, relative: normalized};
}

// ---------------------------------------------------------------------------
// read_repo_file
// ---------------------------------------------------------------------------

export function createReadRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Read a file from the agent repo. Path is relative to repo root. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: z.object({
      path: z.string().min(1).describe('File path relative to repo root (e.g. "knowledge/formatting-rules.md")'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {path: string}, _ctx: ToolContext): Promise<unknown> {
      const validation = validatePath(repoRoot, params.path);
      if ('error' in validation) {
        return {error: validation.error};
      }
      try {
        const content = await readFile(validation.resolved, 'utf-8');
        return {content, path: validation.relative};
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
        const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        return {error: msg};
      }
    },
  };
}

// ---------------------------------------------------------------------------
// write_repo_file
// ---------------------------------------------------------------------------

export function createWriteRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Create or update a file in the agent repo. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: z.object({
      path: z.string().min(1).describe('File path relative to repo root'),
      content: z.string().min(1).describe('Full file content to write'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(params: {path: string; content: string}, _ctx: ToolContext): Promise<unknown> {
      const validation = validatePath(repoRoot, params.path);
      if ('error' in validation) {
        return {error: validation.error};
      }
      if (isReadOnlyPath(validation.relative)) {
        return {error: `${validation.relative} is read-only (installed package)`};
      }
      await mkdir(path.dirname(validation.resolved), {recursive: true});
      await writeFile(validation.resolved, params.content, 'utf-8');
      return {written: validation.relative, bytes: params.content.length};
    },
  };
}

// ---------------------------------------------------------------------------
// delete_repo_file
// ---------------------------------------------------------------------------

export function createDeleteRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Delete a file from the agent repo. Always confirm with the user before deleting. Same directory restrictions as write_repo_file.',
    parameters: z.object({
      path: z.string().min(1).describe('File path relative to repo root'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(params: {path: string}, _ctx: ToolContext): Promise<unknown> {
      const validation = validatePath(repoRoot, params.path);
      if ('error' in validation) {
        return {error: validation.error};
      }
      if (isReadOnlyPath(validation.relative)) {
        return {error: `${validation.relative} is read-only (installed package)`};
      }
      try {
        await unlink(validation.resolved);
        return {deleted: validation.relative};
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
        const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        return {error: msg};
      }
    },
  };
}

// ---------------------------------------------------------------------------
// internal_api
// ---------------------------------------------------------------------------

export function createInternalApiTool(getPort: () => number | null): ToolDefinition {
  return {
    description: "Query the amodal runtime's internal API. Use this to check eval results, connection health, agent context, store data, and automation status. Only GET requests.",
    parameters: z.object({
      endpoint: z.string().min(1).describe('API path (e.g. "/api/evals/runs", "/inspect/health")'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {endpoint: string}, ctx: ToolContext): Promise<unknown> {
      const port = getPort();
      if (!port) {
        throw new ConfigError('Server not ready — cannot query internal API', {
          key: 'server.port',
        });
      }
      const resp = await fetch(`http://127.0.0.1:${String(port)}${params.endpoint}`, {
        signal: ctx.signal ?? AbortSignal.timeout(10_000),
      });
      const text = await resp.text();
      try {
        return {status: resp.status, data: JSON.parse(text)};
      } catch {
        return {status: resp.status, data: text};
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Register all admin tools
// ---------------------------------------------------------------------------

export function registerAdminFileTools(
  registry: ToolRegistry,
  repoRoot: string,
  getPort: () => number | null,
): void {
  registry.register('read_repo_file', createReadRepoFileTool(repoRoot));
  registry.register('write_repo_file', createWriteRepoFileTool(repoRoot));
  registry.register('delete_repo_file', createDeleteRepoFileTool(repoRoot));
  registry.register('internal_api', createInternalApiTool(getPort));
}
