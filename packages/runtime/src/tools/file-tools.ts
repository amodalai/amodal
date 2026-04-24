/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * File tools — sandboxed filesystem access for agent repo directories.
 *
 * Provides 8 tools: read_repo_file, write_repo_file, edit_repo_file,
 * delete_repo_file, list_repo_files, glob_repo_files, grep_repo_files,
 * and read_many_repo_files. All paths are validated against an allowlist
 * of directories and a blocklist of sensitive filenames.
 *
 * When `studioUrl` is set, writes go to Studio's draft API instead of
 * disk, and reads check drafts first (draft overlay).
 */

import {readFile, readdir, writeFile, mkdir, unlink} from 'node:fs/promises';
import * as path from 'node:path';
import {z} from 'zod';
import type {ToolRegistry, ToolContext} from './types.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Sandbox path resolution (inlined from @amodalai/workspace-tools to avoid
// making the private workspace-tools package a published dependency)
// ---------------------------------------------------------------------------

function resolveSandboxPath(sandboxRoot: string, requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) {
    throw new FileToolError(`Absolute paths are not allowed: ${requestedPath}`);
  }
  if (requestedPath.includes('\0')) {
    throw new FileToolError('Path contains null bytes');
  }
  const segments = requestedPath.split(/[/\\]/);
  if (segments.includes('..')) {
    throw new FileToolError(`Path traversal is not allowed: ${requestedPath}`);
  }
  const resolved = path.resolve(sandboxRoot, requestedPath);
  if (resolved !== sandboxRoot && !resolved.startsWith(sandboxRoot + path.sep)) {
    throw new FileToolError(`Path escapes sandbox: ${requestedPath}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_ALLOWED_DIRS = [
  'skills',
  'knowledge',
  'connections',
  'stores',
  'pages',
  'automations',
  'evals',
  'agents',
  'tools',
];

export const DEFAULT_BLOCKED_FILES = [
  '.env',
  'amodal.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
];

/** Maximum number of grep results returned. */
const GREP_MAX_RESULTS = 100;

/** Maximum number of files for read_many_repo_files. */
const READ_MANY_MAX_FILES = 20;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class FileToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileToolError';
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FileToolsOptions {
  repoRoot: string;
  allowedDirs: string[];
  blockedFiles: string[];
  studioUrl?: string;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

function validatePath(
  repoRoot: string,
  filePath: string,
  allowedDirs: string[],
  blockedFiles: string[],
): string {
  const abs = resolveSandboxPath(repoRoot, filePath);
  const rel = path.relative(repoRoot, abs);
  const topDir = rel.split(path.sep)[0];

  if (!allowedDirs.includes(topDir)) {
    throw new FileToolError(
      `Path "${filePath}" is not in an allowed directory. Allowed: ${allowedDirs.join(', ')}`,
    );
  }

  const basename = path.basename(abs);
  if (blockedFiles.includes(basename)) {
    throw new FileToolError(`File "${basename}" cannot be accessed`);
  }

  return abs;
}

/**
 * Validate that a directory path is within allowed dirs.
 * If dir is omitted, returns null (meaning "all allowed dirs").
 */
function validateDirPath(
  repoRoot: string,
  dir: string | undefined,
  allowedDirs: string[],
): string | null {
  if (!dir) return null;

  // The dir itself must be an allowed top-level dir or a subdirectory of one
  const abs = resolveSandboxPath(repoRoot, dir);
  const rel = path.relative(repoRoot, abs);
  const topDir = rel.split(path.sep)[0];

  if (!allowedDirs.includes(topDir)) {
    throw new FileToolError(
      `Directory "${dir}" is not in an allowed directory. Allowed: ${allowedDirs.join(', ')}`,
    );
  }

  return abs;
}

// ---------------------------------------------------------------------------
// Draft API helpers
// ---------------------------------------------------------------------------

async function readFromDraft(studioUrl: string, filePath: string, logger: Logger): Promise<string | null> {
  try {
    const res = await fetch(`${studioUrl}/api/drafts/${encodeURIComponent(filePath)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const raw: unknown = await res.json();
      if (raw && typeof raw === 'object' && 'content' in raw) {
        const val = (raw as Record<string, unknown>)['content'];
        if (typeof val === 'string') return val;
      }
    }
  } catch (err) {
    logger.debug('draft_read_fallback', {path: filePath, error: err instanceof Error ? err.message : String(err)});
  }
  return null;
}

async function writeToDraft(studioUrl: string, filePath: string, content: string): Promise<void> {
  const res = await fetch(`${studioUrl}/api/drafts/${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content}),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new FileToolError(`Failed to save draft: ${res.status} ${res.statusText}`);
  }
}

async function deleteFromDraft(studioUrl: string, filePath: string): Promise<void> {
  const res = await fetch(`${studioUrl}/api/drafts/${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new FileToolError(`Failed to delete draft: ${res.status} ${res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Read helper (with draft overlay)
// ---------------------------------------------------------------------------

async function readFileContent(
  abs: string,
  relPath: string,
  studioUrl: string | undefined,
  logger: Logger,
): Promise<string> {
  // Try draft overlay first
  if (studioUrl) {
    const draftContent = await readFromDraft(studioUrl, relPath, logger);
    if (draftContent !== null) return draftContent;
  }

  // Fall back to disk
  return readFile(abs, 'utf-8');
}

// ---------------------------------------------------------------------------
// Write helper (draft or disk)
// ---------------------------------------------------------------------------

async function writeFileContent(
  abs: string,
  relPath: string,
  content: string,
  studioUrl: string | undefined,
): Promise<void> {
  if (studioUrl) {
    await writeToDraft(studioUrl, relPath, content);
  } else {
    await mkdir(path.dirname(abs), {recursive: true});
    await writeFile(abs, content, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Glob pattern helper
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports *, **, and ? wildcards.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any path segments
        regexStr += '.*';
        i += 2;
        // Skip trailing separator after **
        if (pattern[i] === '/' || pattern[i] === path.sep) {
          i += 1;
        }
      } else {
        // * matches anything except path separator
        regexStr += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if (char === '.') {
      regexStr += '\\.';
      i += 1;
    } else {
      regexStr += char;
      i += 1;
    }
  }

  return new RegExp(`^${regexStr}$`);
}

// ---------------------------------------------------------------------------
// Recursive directory listing
// ---------------------------------------------------------------------------

async function listFilesRecursive(dirPath: string, basePath: string, logger: Logger): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, basePath, logger);
        results.push(...subFiles);
      } else {
        results.push(relPath);
      }
    }
  } catch (err) {
    logger.debug('file_tool_readdir_skipped', {dir: dirPath, error: err instanceof Error ? err.message : String(err)});
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerFileTools(registry: ToolRegistry, opts: FileToolsOptions): void {
  const {repoRoot, allowedDirs, blockedFiles, studioUrl, logger} = opts;

  // -------------------------------------------------------------------------
  // read_repo_file
  // -------------------------------------------------------------------------
  registry.register('read_repo_file', {
    description:
      'Read a file from the agent repository. Supports optional line-based offset and limit for large files.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
      offset: z.number().optional().describe('Line number to start reading from (0-based)'),
      limit: z.number().optional().describe('Maximum number of lines to return'),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {path: string; offset?: number; limit?: number}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        const abs = validatePath(repoRoot, params.path, allowedDirs, blockedFiles);
        const relPath = path.relative(repoRoot, abs);

        logger.debug('file_tool_call', {tool: 'read_repo_file', path: params.path});

        let content = await readFileContent(abs, relPath, studioUrl, logger);

        // Apply line-based offset/limit
        if (params.offset !== undefined || params.limit !== undefined) {
          const lines = content.split('\n');
          const start = params.offset ?? 0;
          const end = params.limit !== undefined ? start + params.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'read_repo_file', path: params.path, durationMs});

        return content;
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'read_repo_file', path: params.path, error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // write_repo_file
  // -------------------------------------------------------------------------
  registry.register('write_repo_file', {
    description: 'Write content to a file in the agent repository. Creates parent directories as needed.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
      content: z.string().describe('The content to write to the file'),
    }),
    readOnly: false,
    metadata: {category: 'system'},

    async execute(params: {path: string; content: string}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        const abs = validatePath(repoRoot, params.path, allowedDirs, blockedFiles);
        const relPath = path.relative(repoRoot, abs);

        logger.debug('file_tool_call', {tool: 'write_repo_file', path: params.path});

        await writeFileContent(abs, relPath, params.content, studioUrl);

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'write_repo_file', path: params.path, durationMs});

        return {success: true, path: params.path};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'write_repo_file', path: params.path, error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // edit_repo_file
  // -------------------------------------------------------------------------
  registry.register('edit_repo_file', {
    description:
      'Edit a file by replacing a string. Reads the current content, finds old_string, and replaces it with new_string. ' +
      'If multiple matches are found and allow_multiple is not set, returns an error.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
      old_string: z.string().describe('The exact string to find and replace'),
      new_string: z.string().describe('The replacement string'),
      allow_multiple: z.boolean().optional().describe('Allow replacing all occurrences if multiple matches found'),
    }),
    readOnly: false,
    metadata: {category: 'system'},

    async execute(
      params: {path: string; old_string: string; new_string: string; allow_multiple?: boolean},
      _ctx: ToolContext,
    ): Promise<unknown> {
      const startMs = Date.now();
      try {
        const abs = validatePath(repoRoot, params.path, allowedDirs, blockedFiles);
        const relPath = path.relative(repoRoot, abs);

        logger.debug('file_tool_call', {tool: 'edit_repo_file', path: params.path});

        const content = await readFileContent(abs, relPath, studioUrl, logger);

        // Count occurrences
        let count = 0;
        let idx = 0;
        while (true) {
          idx = content.indexOf(params.old_string, idx);
          if (idx === -1) break;
          count += 1;
          idx += params.old_string.length;
        }

        if (count === 0) {
          return {error: `String not found in ${params.path}`};
        }

        if (count > 1 && !params.allow_multiple) {
          return {error: `Multiple matches found (${String(count)}), set allow_multiple: true to replace all`};
        }

        // Replace
        let newContent: string;
        if (params.allow_multiple) {
          newContent = content.split(params.old_string).join(params.new_string);
        } else {
          newContent = content.replace(params.old_string, params.new_string);
        }

        await writeFileContent(abs, relPath, newContent, studioUrl);

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'edit_repo_file', path: params.path, replacements: count, durationMs});

        return {success: true, path: params.path, replacements: count};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'edit_repo_file', path: params.path, error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // delete_repo_file
  // -------------------------------------------------------------------------
  registry.register('delete_repo_file', {
    description: 'Delete a file from the agent repository.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within the repo'),
    }),
    readOnly: false,
    metadata: {category: 'system'},

    async execute(params: {path: string}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        const abs = validatePath(repoRoot, params.path, allowedDirs, blockedFiles);
        const relPath = path.relative(repoRoot, abs);

        logger.debug('file_tool_call', {tool: 'delete_repo_file', path: params.path});

        if (studioUrl) {
          await deleteFromDraft(studioUrl, relPath);
        } else {
          await unlink(abs);
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'delete_repo_file', path: params.path, durationMs});

        return {success: true, path: params.path};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'delete_repo_file', path: params.path, error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // list_repo_files
  // -------------------------------------------------------------------------
  registry.register('list_repo_files', {
    description:
      'List files in the agent repository. If dir is provided, lists that directory. ' +
      'If omitted, lists all allowed directories.',
    parameters: z.object({
      dir: z.string().optional().describe(
        'Directory to list (relative path). If omitted, lists all allowed directories.',
      ),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {dir?: string}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        logger.debug('file_tool_call', {tool: 'list_repo_files', dir: params.dir});

        let files: string[];

        if (params.dir) {
          const absDir = validateDirPath(repoRoot, params.dir, allowedDirs);
          if (!absDir) {
            return {error: 'Invalid directory'};
          }
          files = await listFilesRecursive(absDir, repoRoot, logger);
        } else {
          // List all allowed directories
          files = [];
          for (const dir of allowedDirs) {
            const absDir = path.join(repoRoot, dir);
            const dirFiles = await listFilesRecursive(absDir, repoRoot, logger);
            files.push(...dirFiles);
          }
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'list_repo_files', fileCount: files.length, durationMs});

        return {files};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'list_repo_files', error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // glob_repo_files
  // -------------------------------------------------------------------------
  registry.register('glob_repo_files', {
    description:
      'Find files matching a glob pattern in the agent repository. ' +
      'Supports *, **, and ? wildcards. Only searches allowed directories.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern to match files against (e.g., "**/*.yaml", "skills/*.md")'),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {pattern: string}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        logger.debug('file_tool_call', {tool: 'glob_repo_files', pattern: params.pattern});

        const regex = globToRegex(params.pattern);
        const matches: string[] = [];

        for (const dir of allowedDirs) {
          const absDir = path.join(repoRoot, dir);
          const files = await listFilesRecursive(absDir, repoRoot, logger);
          for (const file of files) {
            if (regex.test(file)) {
              matches.push(file);
            }
          }
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'glob_repo_files', matchCount: matches.length, durationMs});

        return {files: matches};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'glob_repo_files', error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // grep_repo_files
  // -------------------------------------------------------------------------
  registry.register('grep_repo_files', {
    description:
      'Search file contents with a regex pattern. Returns matching lines with file path and line number. ' +
      'Capped at 100 results. Only searches allowed directories.',
    parameters: z.object({
      pattern: z.string().describe('Regex pattern to search for in file contents'),
      dir: z.string().optional().describe('Directory to search in (relative path). If omitted, searches all allowed directories.'),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {pattern: string; dir?: string}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        logger.debug('file_tool_call', {tool: 'grep_repo_files', pattern: params.pattern, dir: params.dir});

        let regex: RegExp;
        try {
          regex = new RegExp(params.pattern);
        } catch {
          return {error: `Invalid regex pattern: ${params.pattern}`};
        }

        const results: Array<{file: string; line: number; content: string}> = [];

        // Determine which directories to search
        const dirsToSearch: string[] = [];
        if (params.dir) {
          const absDir = validateDirPath(repoRoot, params.dir, allowedDirs);
          if (!absDir) {
            return {error: 'Invalid directory'};
          }
          dirsToSearch.push(params.dir);
        } else {
          dirsToSearch.push(...allowedDirs);
        }

        for (const dir of dirsToSearch) {
          if (results.length >= GREP_MAX_RESULTS) break;

          const absDir = path.join(repoRoot, dir);
          const files = await listFilesRecursive(absDir, repoRoot, logger);

          for (const file of files) {
            if (results.length >= GREP_MAX_RESULTS) break;

            const absFile = path.join(repoRoot, file);
            try {
              const content = await readFile(absFile, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= GREP_MAX_RESULTS) break;
                if (regex.test(lines[i])) {
                  results.push({file, line: i + 1, content: lines[i]});
                }
              }
            } catch (err) {
              logger.debug('file_tool_grep_skip', {file, error: err instanceof Error ? err.message : String(err)});
            }
          }
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'grep_repo_files', resultCount: results.length, durationMs});

        return {results, truncated: results.length >= GREP_MAX_RESULTS};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'grep_repo_files', error: message, durationMs});
        return {error: message};
      }
    },
  });

  // -------------------------------------------------------------------------
  // read_many_repo_files
  // -------------------------------------------------------------------------
  registry.register('read_many_repo_files', {
    description:
      'Read multiple files at once. Returns an object mapping each path to its content. ' +
      `Maximum ${String(READ_MANY_MAX_FILES)} files per call.`,
    parameters: z.object({
      paths: z.array(z.string()).max(READ_MANY_MAX_FILES).describe(
        `Array of relative file paths to read (max ${String(READ_MANY_MAX_FILES)})`,
      ),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {paths: string[]}, _ctx: ToolContext): Promise<unknown> {
      const startMs = Date.now();
      try {
        logger.debug('file_tool_call', {tool: 'read_many_repo_files', fileCount: params.paths.length});

        if (params.paths.length > READ_MANY_MAX_FILES) {
          return {error: `Too many files requested. Maximum is ${String(READ_MANY_MAX_FILES)}.`};
        }

        const results: Record<string, string | {error: string}> = {};

        for (const filePath of params.paths) {
          try {
            const abs = validatePath(repoRoot, filePath, allowedDirs, blockedFiles);
            const relPath = path.relative(repoRoot, abs);
            results[filePath] = await readFileContent(abs, relPath, studioUrl, logger);
          } catch (err) {
            results[filePath] = {error: err instanceof Error ? err.message : String(err)};
          }
        }

        const durationMs = Date.now() - startMs;
        logger.debug('file_tool_complete', {tool: 'read_many_repo_files', fileCount: params.paths.length, durationMs});

        return results;
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        logger.debug('file_tool_error', {tool: 'read_many_repo_files', error: message, durationMs});
        return {error: message};
      }
    },
  });
}
