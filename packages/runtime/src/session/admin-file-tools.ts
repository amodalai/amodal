/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin-only file tools for reading, writing, and deleting agent config files.
 * These tools are registered on admin sessions only, and only for local repos.
 *
 * Returns ToolDefinition objects (Zod schemas, typed execute) that can be
 * registered on the local ToolRegistry and bridged to the upstream registry.
 */

import {readFile, writeFile, unlink, mkdir} from 'node:fs/promises';
import * as path from 'node:path';
import {z} from 'zod';
import type {ToolDefinition, ToolContext} from '../tools/types.js';
import {ToolExecutionError} from '../errors.js';

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
  'amodal_packages/',  // installed packages (read-only)
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
// JSON Schema definitions (for upstream bridge)
// ---------------------------------------------------------------------------

export const ADMIN_TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  read_repo_file: {
    type: 'object',
    properties: {
      path: {type: 'string', description: 'File path relative to repo root (e.g. "knowledge/formatting-rules.md")'},
    },
    required: ['path'],
  },
  write_repo_file: {
    type: 'object',
    properties: {
      path: {type: 'string', description: 'File path relative to repo root (e.g. "knowledge/formatting-rules.md")'},
      content: {type: 'string', description: 'Full file content to write'},
    },
    required: ['path', 'content'],
  },
  delete_repo_file: {
    type: 'object',
    properties: {
      path: {type: 'string', description: 'File path relative to repo root (e.g. "evals/old-test.md")'},
    },
    required: ['path'],
  },
  internal_api: {
    type: 'object',
    properties: {
      endpoint: {type: 'string', description: 'API path (e.g. "/api/evals/runs", "/inspect/health", "/api/stores")'},
    },
    required: ['endpoint'],
  },
};

// ---------------------------------------------------------------------------
// Tool factories (return ToolDefinition)
// ---------------------------------------------------------------------------

export function createReadRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Read a file from the agent repo. Path is relative to repo root. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: z.object({
      path: z.string().describe('File path relative to repo root'),
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
        const isNotFound = err instanceof Error && 'code' in err && (err as unknown as {code?: string}).code === 'ENOENT'; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- narrowing errno code
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        throw new ToolExecutionError(msg, {
          toolName: 'read_repo_file',
          callId: '',
          cause: err,
          context: {path: validation.relative},
        });
      }
    },
  };
}

export function createWriteRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Create or update a file in the agent repo. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: z.object({
      path: z.string().describe('File path relative to repo root'),
      content: z.string().describe('Full file content to write'),
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
      if (!params.content) {
        return {error: 'Content must not be empty'};
      }
      try {
        await mkdir(path.dirname(validation.resolved), {recursive: true});
        await writeFile(validation.resolved, params.content, 'utf-8');
        return {written: true, path: validation.relative, bytes: params.content.length};
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ToolExecutionError(msg, {
          toolName: 'write_repo_file',
          callId: '',
          cause: err,
          context: {path: validation.relative},
        });
      }
    },
  };
}

export function createDeleteRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Delete a file from the agent repo. Always confirm with the user before deleting. Same directory restrictions as write_repo_file.',
    parameters: z.object({
      path: z.string().describe('File path relative to repo root'),
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
        return {deleted: true, path: validation.relative};
      } catch (err) {
        const isNotFound = err instanceof Error && 'code' in err && (err as unknown as {code?: string}).code === 'ENOENT'; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- narrowing errno code
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        throw new ToolExecutionError(msg, {
          toolName: 'delete_repo_file',
          callId: '',
          cause: err,
          context: {path: validation.relative},
        });
      }
    },
  };
}

export function createInternalApiTool(getPort: () => number | null): ToolDefinition {
  return {
    description: `Query the amodal runtime's internal API. Use this to check eval results, connection health, agent context, store data, and automation status. Only GET requests.`,
    parameters: z.object({
      endpoint: z.string().describe('API path (e.g. "/api/evals/runs", "/inspect/health", "/api/stores")'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {endpoint: string}, _ctx: ToolContext): Promise<unknown> {
      const port = getPort();
      if (!port) {
        return {error: 'Server not ready'};
      }
      try {
        const resp = await fetch(`http://127.0.0.1:${port}${params.endpoint}`, {
          signal: AbortSignal.timeout(10_000),
        });
        const text = await resp.text();
        try {
          return {status: resp.status, data: JSON.parse(text)};
        } catch {
          return {status: resp.status, data: text};
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ToolExecutionError(msg, {
          toolName: 'internal_api',
          callId: '',
          cause: err,
          context: {endpoint: params.endpoint},
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Register admin tools on a ToolRegistry
// ---------------------------------------------------------------------------

export function registerAdminTools(
  registry: import('../tools/types.js').ToolRegistry,
  repoRoot: string,
  getPort?: () => number | null,
): void {
  registry.register('read_repo_file', createReadRepoFileTool(repoRoot));
  registry.register('write_repo_file', createWriteRepoFileTool(repoRoot));
  registry.register('delete_repo_file', createDeleteRepoFileTool(repoRoot));
  if (getPort) {
    registry.register('internal_api', createInternalApiTool(getPort));
  }
}
