/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin-only file tools for reading, writing, and deleting agent config files.
 * These tools are registered on admin sessions only, and only for local repos.
 *
 * Ported from the old agent-runner.ts admin tool implementation.
 */

import {readFile, writeFile, unlink, mkdir} from 'node:fs/promises';
import * as path from 'node:path';

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
];

const BLOCKED_FILENAMES = [
  '.env',
  'amodal.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
];

/** @internal Exported for testing */
export function isAllowedRepoPath(relPath: string): boolean {
  const basename = path.basename(relPath);
  if (BLOCKED_FILENAMES.includes(basename)) return false;
  return ALLOWED_REPO_DIRS.some((dir) => relPath.startsWith(dir));
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
// Tool result type
// ---------------------------------------------------------------------------

interface ToolResult {
  llmContent: string;
  returnDisplay?: string;
  error?: {message: string; type: string};
}

// ---------------------------------------------------------------------------
// Base adapter matching upstream DeclarativeTool interface
// ---------------------------------------------------------------------------

function createToolAdapter(opts: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}) {
  return {
    name: opts.name,
    displayName: opts.name,
    description: opts.description,
    kind: 'declarative' as const,
    parameterSchema: opts.parameters,
    get isReadOnly() { return opts.name === 'read_repo_file'; },
    get toolAnnotations() { return undefined; },
    get schema() { return this.getSchema(); },
    getSchema() {
      return {
        name: opts.name,
        description: opts.description,
        parametersJsonSchema: opts.parameters,
      };
    },
    build(params: Record<string, unknown>) {
      return {
        name: opts.name,
        params,
        execute: async () => opts.execute(params),
      };
    },
    silentBuild(params: Record<string, unknown>) {
      return this.build(params);
    },
    async validateBuildAndExecute(params: Record<string, unknown>) {
      return opts.execute(params);
    },
  };
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createReadRepoFileTool(repoRoot: string) {
  return createToolAdapter({
    name: 'read_repo_file',
    description: 'Read a file from the agent repo. Path is relative to repo root. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'File path relative to repo root (e.g. "knowledge/formatting-rules.md")'},
      },
      required: ['path'],
    },
    async execute(params) {
      const rawPath = String(params['path'] ?? '');
      const validation = validatePath(repoRoot, rawPath);
      if ('error' in validation) {
        return {llmContent: `Error: ${validation.error}`, error: {message: validation.error, type: 'VALIDATION_ERROR'}};
      }
      try {
        const content = await readFile(validation.resolved, 'utf-8');
        return {llmContent: content, returnDisplay: `Read ${validation.relative}`};
      } catch (err) {
        const isNotFound = err instanceof Error && 'code' in err && ((err as {code?: string}).code) === 'ENOENT' // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- checking errno;
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        return {llmContent: `Error: ${msg}`, error: {message: msg, type: 'EXECUTION_FAILED'}};
      }
    },
  });
}

export function createWriteRepoFileTool(repoRoot: string) {
  return createToolAdapter({
    name: 'write_repo_file',
    description: 'Create or update a file in the agent repo. Use this to add skills, knowledge, pages, automations, tools, store schemas, evals, connection docs, or agent overrides. Path is relative to repo root. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'File path relative to repo root (e.g. "knowledge/formatting-rules.md")'},
        content: {type: 'string', description: 'Full file content to write'},
      },
      required: ['path', 'content'],
    },
    async execute(params) {
      const rawPath = String(params['path'] ?? '');
      const content = String(params['content'] ?? '');
      const validation = validatePath(repoRoot, rawPath);
      if ('error' in validation) {
        return {llmContent: `Error: ${validation.error}`, error: {message: validation.error, type: 'VALIDATION_ERROR'}};
      }
      if (!content) {
        return {llmContent: 'Error: Content must not be empty', error: {message: 'Content must not be empty', type: 'VALIDATION_ERROR'}};
      }
      try {
        await mkdir(path.dirname(validation.resolved), {recursive: true});
        await writeFile(validation.resolved, content, 'utf-8');
        return {llmContent: `Wrote ${validation.relative} (${String(content.length)} bytes)`, returnDisplay: `Wrote ${validation.relative}`};
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {llmContent: `Error: ${msg}`, error: {message: msg, type: 'EXECUTION_FAILED'}};
      }
    },
  });
}

export function createDeleteRepoFileTool(repoRoot: string) {
  return createToolAdapter({
    name: 'delete_repo_file',
    description: 'Delete a file from the agent repo. Always confirm with the user before deleting. Path is relative to repo root. Same directory restrictions as write_repo_file.',
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string', description: 'File path relative to repo root (e.g. "evals/old-test.md")'},
      },
      required: ['path'],
    },
    async execute(params) {
      const rawPath = String(params['path'] ?? '');
      const validation = validatePath(repoRoot, rawPath);
      if ('error' in validation) {
        return {llmContent: `Error: ${validation.error}`, error: {message: validation.error, type: 'VALIDATION_ERROR'}};
      }
      try {
        await unlink(validation.resolved);
        return {llmContent: `Deleted ${validation.relative}`, returnDisplay: `Deleted ${validation.relative}`};
      } catch (err) {
        const isNotFound = err instanceof Error && 'code' in err && ((err as {code?: string}).code) === 'ENOENT' // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- checking errno;
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        return {llmContent: `Error: ${msg}`, error: {message: msg, type: 'EXECUTION_FAILED'}};
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Internal API tool — lets admin query the local runtime's own endpoints
// ---------------------------------------------------------------------------

export function createInternalApiTool(getPort: () => number | null) {
  return createToolAdapter({
    name: 'internal_api',
    description: `Query the amodal runtime's internal API. Use this to check eval results, connection health, agent context, store data, and automation status. The endpoint is relative to the local server (e.g. "/api/evals/runs" or "/inspect/health"). Only GET requests are supported.`,
    parameters: {
      type: 'object',
      properties: {
        endpoint: {type: 'string', description: 'API path (e.g. "/api/evals/runs", "/inspect/health", "/api/stores")'},
      },
      required: ['endpoint'],
    },
    async execute(params) {
      const endpoint = String(params['endpoint'] ?? '');
      const port = getPort();
      if (!port) {
        return {llmContent: 'Error: Server not ready', error: {message: 'Server not ready', type: 'EXECUTION_FAILED'}};
      }
      try {
        const resp = await fetch(`http://127.0.0.1:${port}${endpoint}`);
        const text = await resp.text();
        try {
          const json = JSON.parse(text);
          return {llmContent: JSON.stringify(json, null, 2), returnDisplay: `GET ${endpoint} → ${resp.status}`};
        } catch {
          return {llmContent: text, returnDisplay: `GET ${endpoint} → ${resp.status}`};
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {llmContent: `Error: ${msg}`, error: {message: msg, type: 'EXECUTION_FAILED'}};
      }
    },
  });
}
