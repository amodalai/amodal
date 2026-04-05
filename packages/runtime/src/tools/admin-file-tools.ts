/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin file tools for managing agent repo files.
 *
 * Nine tools:
 *   Read/write single files:
 *   - read_repo_file          — read a file from the agent repo
 *   - write_repo_file         — create or update a file (full rewrite)
 *   - delete_repo_file        — delete a file
 *   - edit_repo_file          — in-place find-and-replace edit (preserves
 *                               the rest of the file)
 *   Discovery:
 *   - list_repo_files         — list files in an allowed directory
 *   - glob_repo_files         — find files matching a glob pattern
 *   - grep_repo_files         — regex content search across files
 *   - read_many_repo_files    — batched read of multiple files
 *   Introspection:
 *   - internal_api            — GET the runtime's own API
 *
 * All tools enforce the same allowed-directory allowlist and never touch
 * sensitive files (.env, amodal.json, package.json, etc.).
 */

import {readFile, writeFile, unlink, mkdir, stat, readdir} from 'node:fs/promises';
import * as path from 'node:path';
import {z} from 'zod';
import {glob as globImpl} from 'glob';
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

// ---------------------------------------------------------------------------
// Caps + skip patterns (tunable knobs for the discovery tools)
// ---------------------------------------------------------------------------

/** Always skipped when walking directories or matching globs. */
export const SKIP_DIR_NAMES: readonly string[] = ['.git', 'node_modules', '.DS_Store'];

/** Max entries `list_repo_files` returns in a single call. */
export const LIST_MAX_ENTRIES = 2000;
/** Max files `glob_repo_files` returns in a single call. */
export const GLOB_MAX_FILES = 500;
/** Max matches `grep_repo_files` returns in a single call (matches gemini-cli). */
export const GREP_MAX_MATCHES = 100;
/** Max bytes `grep_repo_files` will read from any single file before skipping. */
export const GREP_FILE_SIZE_LIMIT = 5_000_000; // 5 MB
/** Max files `read_many_repo_files` returns in a single call. */
export const READ_MANY_MAX_FILES = 20;
/** Max bytes per file returned by `read_many_repo_files` before truncation. */
export const READ_MANY_MAX_BYTES = 50_000;
/**
 * Default number of lines `read_repo_file` returns when no `limit` is passed.
 * Matches the conventions of Claude Code's Read tool and gemini-cli's
 * read_file — long files are truncated by default and the agent paginates
 * only when it needs to. Prevents single reads from blowing the context
 * window on large config/lockfile/log inputs.
 */
export const READ_FILE_DEFAULT_LINES = 2000;
/** Hard upper bound on `limit` — even explicit requests cannot exceed this. */
export const READ_FILE_MAX_LINES = 10_000;

/** Top-level directory entry of the allowlist, without the trailing slash. */
const ALLOWED_TOP_LEVEL_NAMES = ALLOWED_REPO_DIRS.map((d) => d.replace(/\/$/, ''));

/**
 * Filesystem error codes we treat as "skip this entry, keep going" during
 * best-effort directory walks (list_repo_files, glob_repo_files,
 * grep_repo_files). These correspond to "the path isn't there / isn't
 * accessible / isn't the kind of thing we expected" — all of which are
 * normal during a concurrent walk. Any other error code is unexpected
 * (ENOMEM, EIO, etc.) and will be re-thrown rather than silently dropped.
 */
const EXPECTED_FS_SKIP_CODES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EISDIR', 'EPERM']);

function isExpectedFsSkipError(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
  const code = (err as NodeJS.ErrnoException).code;
  return code !== undefined && EXPECTED_FS_SKIP_CODES.has(code);
}

/**
 * Count lines in a string. A trailing empty line from a terminal \n is NOT
 * counted — a file whose content is "a\nb\n" is "2 lines" to humans, not 3.
 */
function countLines(text: string): number {
  const parts = text.split(/\r?\n/);
  return (parts.length > 0 && parts[parts.length - 1] === '') ? parts.length - 1 : parts.length;
}

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

  // Bare allowlisted-directory name (e.g. "skills", no trailing slash or
  // child path) — common agent mistake. Give a directed error instead of
  // the generic "not in an allowed directory".
  if (ALLOWED_TOP_LEVEL_NAMES.includes(normalized)) {
    return {
      error: `Path "${normalized}" is a directory — use list_repo_files to enumerate its contents, or provide a file path like "${normalized}/<name>".`,
    };
  }

  if (!isAllowedRepoPath(normalized)) {
    return {error: `Path "${normalized}" is not in an allowed directory. Allowed: ${ALLOWED_REPO_DIRS.join(', ')}. Blocked files: ${BLOCKED_FILENAMES.join(', ')}`};
  }

  const resolved = path.resolve(repoRoot, normalized);
  if (!resolved.startsWith(repoRoot)) {
    return {error: 'Resolved path escapes the repo directory'};
  }

  return {resolved, relative: normalized};
}

/**
 * Validate a directory path for the discovery tools (list/glob/grep).
 * Unlike `validatePath`, this accepts bare allowlist names ("skills") as
 * valid inputs — the whole point is to look inside a directory.
 *
 * Returns the absolute path on the filesystem + the relative form, or an
 * error message describing why the directory was rejected.
 */
function validateDirPath(
  repoRoot: string,
  rawDir: string,
): {error: string} | {resolved: string; relative: string} {
  if (!rawDir || rawDir.startsWith('/')) {
    return {error: 'Directory must be relative to the repo root (no leading /)'};
  }
  if (rawDir.includes('..')) {
    return {error: 'Path traversal (..) is not allowed'};
  }

  const normalized = path.normalize(rawDir).replace(/\/$/, '');

  // Bare allowlist dir ("skills"): allowed for directory operations.
  if (ALLOWED_TOP_LEVEL_NAMES.includes(normalized)) {
    const resolved = path.resolve(repoRoot, normalized);
    if (!resolved.startsWith(repoRoot)) {
      return {error: 'Resolved path escapes the repo directory'};
    }
    return {resolved, relative: normalized};
  }

  // Child of an allowlist dir ("skills/triage").
  const startsWithAllowed = ALLOWED_REPO_DIRS.some((dir) => normalized.startsWith(dir));
  if (!startsWithAllowed) {
    return {error: `Directory "${normalized}" is not in an allowed directory. Allowed top-level dirs: ${ALLOWED_TOP_LEVEL_NAMES.join(', ')}`};
  }

  const resolved = path.resolve(repoRoot, normalized);
  if (!resolved.startsWith(repoRoot)) {
    return {error: 'Resolved path escapes the repo directory'};
  }
  return {resolved, relative: normalized};
}

/**
 * Walk a directory, yielding repo-relative file paths. Skips SKIP_DIR_NAMES
 * entries and any files whose basename is in BLOCKED_FILENAMES. Stops after
 * `limit` paths have been collected, returning `truncated: true` so the
 * caller can tell the agent to narrow the query.
 */
async function walkFiles(
  repoRoot: string,
  startAbs: string,
  recursive: boolean,
  limit: number,
): Promise<{files: string[]; truncated: boolean}> {
  const files: string[] = [];
  let truncated = false;

  const queue: string[] = [startAbs];
  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (current === undefined) break;

    let entries;
    try {
      entries = await readdir(current, {withFileTypes: true});
    } catch (err) {
      // Path gone / no permissions / not a dir — expected during a
      // concurrent walk, skip. Unexpected errors (ENOMEM, EIO) bubble.
      if (isExpectedFsSkipError(err)) continue;
      throw err;
    }

    // Sort for determinism — agents see the same order across identical calls.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (SKIP_DIR_NAMES.includes(entry.name)) continue;
      if (BLOCKED_FILENAMES.includes(entry.name)) continue;

      const absChild = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) queue.push(absChild);
      } else if (entry.isFile()) {
        files.push(path.relative(repoRoot, absChild));
        if (files.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }

  return {files, truncated};
}

// ---------------------------------------------------------------------------
// read_repo_file
// ---------------------------------------------------------------------------

export function createReadRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: `Read a file from the agent repo. By default returns the first ${String(READ_FILE_DEFAULT_LINES)} lines — for longer files, the response sets truncated: true and includes total_lines so you know how much more there is. Use offset + limit to paginate through the rest. Path is relative to repo root. Allowed directories: skills/, knowledge/, connections/, stores/, pages/, automations/, evals/, agents/, tools/.`,
    parameters: z.object({
      path: z.string().min(1).describe('File path relative to repo root (e.g. "knowledge/formatting-rules.md")'),
      offset: z.number().int().min(1).optional().describe(`Line number to start reading from (1-indexed, default 1). Use with limit to paginate long files — call again with offset: line_end + 1 to read the next chunk.`),
      limit: z.number().int().min(1).max(READ_FILE_MAX_LINES).optional().describe(`Max lines to return (default ${String(READ_FILE_DEFAULT_LINES)}, max ${String(READ_FILE_MAX_LINES)})`),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(
      params: {path: string; offset?: number; limit?: number},
      _ctx: ToolContext,
    ): Promise<unknown> {
      const validation = validatePath(repoRoot, params.path);
      if ('error' in validation) {
        return {error: validation.error};
      }

      let buf: Buffer;
      try {
        buf = await readFile(validation.resolved);
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
        const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        const msg = isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err));
        return {error: msg};
      }

      if (isLikelyBinary(buf)) {
        return {error: `Binary file: ${validation.relative} (read_repo_file returns text only)`};
      }

      const text = buf.toString('utf-8');
      const lines = text.split(/\r?\n/);
      const totalLines = countLines(text);

      const offset = Math.max(1, params.offset ?? 1);
      const limit = Math.max(1, Math.min(params.limit ?? READ_FILE_DEFAULT_LINES, READ_FILE_MAX_LINES));

      // offset is 1-indexed; slice is 0-indexed.
      const startIdx = offset - 1;
      const endIdx = Math.min(startIdx + limit, totalLines);
      const slice = lines.slice(startIdx, endIdx);

      return {
        content: slice.join('\n'),
        path: validation.relative,
        line_start: offset,
        line_end: endIdx, // 1-indexed, inclusive
        total_lines: totalLines,
        ...(endIdx < totalLines ? {truncated: true} : {}),
      };
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
// list_repo_files
// ---------------------------------------------------------------------------

export function createListRepoFilesTool(repoRoot: string): ToolDefinition {
  return {
    description: `List files in an agent-repo directory. Returns file paths relative to the repo root. Omit "dir" to list every allowed top-level directory at once. Call this BEFORE read_repo_file when you don't know exact filenames — guessing paths wastes turns. Capped at ${String(LIST_MAX_ENTRIES)} entries; narrow with "dir" if truncated.`,
    parameters: z.object({
      dir: z.string().optional().describe(
        `Directory to list, relative to repo root (e.g. "skills", "knowledge/formatting-rules"). Must be inside one of: ${ALLOWED_TOP_LEVEL_NAMES.join(', ')}. Omit to list all allowed top-level directories at once.`,
      ),
      recursive: z.boolean().default(true).describe('Walk subdirectories (default true)'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {dir?: string; recursive?: boolean}, _ctx: ToolContext): Promise<unknown> {
      const recursive = params.recursive ?? true;

      // No dir → list every allowlisted top-level directory at once.
      if (params.dir === undefined) {
        const collected: string[] = [];
        let truncated = false;
        for (const name of ALLOWED_TOP_LEVEL_NAMES) {
          const absDir = path.resolve(repoRoot, name);
          const remaining = LIST_MAX_ENTRIES - collected.length;
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          const result = await walkFiles(repoRoot, absDir, recursive, remaining);
          collected.push(...result.files);
          if (result.truncated) {
            truncated = true;
            break;
          }
        }
        return {dir: null, files: collected, ...(truncated ? {truncated: true} : {})};
      }

      const validation = validateDirPath(repoRoot, params.dir);
      if ('error' in validation) return {error: validation.error};

      const {files, truncated} = await walkFiles(repoRoot, validation.resolved, recursive, LIST_MAX_ENTRIES);
      return {dir: validation.relative, files, ...(truncated ? {truncated: true} : {})};
    },
  };
}

// ---------------------------------------------------------------------------
// glob_repo_files
// ---------------------------------------------------------------------------

export function createGlobRepoFilesTool(repoRoot: string): ToolDefinition {
  return {
    description: `Find files in the agent repo matching a glob pattern (e.g. "**/SKILL.md", "skills/**/*.md", "knowledge/*.md"). Returns repo-relative file paths, newest first (files modified in the last 24h are surfaced first, then lexical). Capped at ${String(GLOB_MAX_FILES)} results. Use this for structural searches like "find all skills" or "find all spec.json files".`,
    parameters: z.object({
      pattern: z.string().min(1).describe(
        'Glob pattern to match (e.g. "**/*.md", "skills/**/SKILL.md"). Matches are filtered down to the allowed-directory allowlist after globbing.',
      ),
      case_sensitive: z.boolean().default(false).describe('Case-sensitive matching (default false)'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {pattern: string; case_sensitive?: boolean}, _ctx: ToolContext): Promise<unknown> {
      if (params.pattern.includes('..')) {
        return {error: 'Glob pattern traversal (..) is not allowed'};
      }

      const absMatches = await globImpl(params.pattern, {
        cwd: repoRoot,
        nodir: true,
        dot: true,
        nocase: !(params.case_sensitive ?? false),
        follow: false,
        ignore: SKIP_DIR_NAMES.map((n) => `**/${n}/**`),
        withFileTypes: true,
        stat: true,
      });

      // Recent-first sort: files touched in the last 24h surface first,
      // ordered newest-to-oldest; everything else falls back to lexical.
      // Matches the agent-ergonomics pattern from gemini-cli's glob tool.
      const now = Date.now();
      const recencyMs = 24 * 60 * 60 * 1000;
      const sorted = [...absMatches].sort((a, b) => {
        const ma = a.mtimeMs ?? 0;
        const mb = b.mtimeMs ?? 0;
        const aRecent = now - ma < recencyMs;
        const bRecent = now - mb < recencyMs;
        if (aRecent && bRecent) return mb - ma;
        if (aRecent) return -1;
        if (bRecent) return 1;
        return a.fullpath().localeCompare(b.fullpath());
      });

      const relative: string[] = [];
      let truncated = false;
      for (const entry of sorted) {
        const rel = path.relative(repoRoot, entry.fullpath());
        if (!isAllowedRepoPath(rel)) continue;
        relative.push(rel);
        if (relative.length >= GLOB_MAX_FILES) {
          truncated = true;
          break;
        }
      }

      return {pattern: params.pattern, files: relative, ...(truncated ? {truncated: true} : {})};
    },
  };
}

// ---------------------------------------------------------------------------
// grep_repo_files
// ---------------------------------------------------------------------------

function isLikelyBinary(buf: Buffer): boolean {
  // Quick heuristic: look for a NUL byte in the first 8KB.
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function createGrepRepoFilesTool(repoRoot: string): ToolDefinition {
  return {
    description: `Search file contents in the agent repo for a regex pattern. Returns matching {file, line_number, text} entries, capped at ${String(GREP_MAX_MATCHES)} matches total. Use for "where is X defined?" or "which skills mention Y?" queries. Searches files under the allowed-directory allowlist only.`,
    parameters: z.object({
      pattern: z.string().min(1).describe('Regular expression to search for (JavaScript regex syntax).'),
      dir: z.string().optional().describe(
        `Directory to search under, relative to repo root (e.g. "skills", "knowledge"). Must be inside one of: ${ALLOWED_TOP_LEVEL_NAMES.join(', ')}. Omit to search all allowed top-level directories.`,
      ),
      case_insensitive: z.boolean().default(true).describe('Case-insensitive search (default true)'),
      include: z.string().optional().describe('Glob filter for filenames (e.g. "*.md", "**/*.json"). Evaluated against repo-relative paths.'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(
      params: {pattern: string; dir?: string; case_insensitive?: boolean; include?: string},
      _ctx: ToolContext,
    ): Promise<unknown> {
      // Compile the regex once — surface a clean error on invalid syntax.
      let re: RegExp;
      try {
        re = new RegExp(params.pattern, (params.case_insensitive ?? true) ? 'i' : '');
      } catch (err) {
        return {error: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`};
      }

      // Resolve candidate files.
      const includePattern = params.include ?? '**/*';
      const searchDirs: string[] = [];
      if (params.dir !== undefined) {
        const validation = validateDirPath(repoRoot, params.dir);
        if ('error' in validation) return {error: validation.error};
        searchDirs.push(validation.relative);
      } else {
        searchDirs.push(...ALLOWED_TOP_LEVEL_NAMES);
      }

      const matches: Array<{file: string; line_number: number; text: string}> = [];
      let truncated = false;

      outer: for (const dir of searchDirs) {
        const absMatches = await globImpl(includePattern, {
          cwd: path.join(repoRoot, dir),
          nodir: true,
          dot: true,
          follow: false,
          ignore: SKIP_DIR_NAMES.map((n) => `**/${n}/**`),
          withFileTypes: true,
        });

        for (const entry of absMatches) {
          const absFile = entry.fullpath();
          const relFile = path.relative(repoRoot, absFile);
          if (!isAllowedRepoPath(relFile)) continue;

          let stats;
          try {
            stats = await stat(absFile);
          } catch (err) {
            // File vanished between glob and stat, or not readable — skip.
            if (isExpectedFsSkipError(err)) continue;
            throw err;
          }
          if (stats.size > GREP_FILE_SIZE_LIMIT) continue;

          let buf: Buffer;
          try {
            buf = await readFile(absFile);
          } catch (err) {
            // File vanished between stat and read, or not readable — skip.
            if (isExpectedFsSkipError(err)) continue;
            throw err;
          }
          if (isLikelyBinary(buf)) continue;

          const lines = buf.toString('utf-8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              matches.push({file: relFile, line_number: i + 1, text: lines[i]});
              if (matches.length >= GREP_MAX_MATCHES) {
                truncated = true;
                break outer;
              }
            }
          }
        }
      }

      return {pattern: params.pattern, matches, ...(truncated ? {truncated: true} : {})};
    },
  };
}

// ---------------------------------------------------------------------------
// edit_repo_file
// ---------------------------------------------------------------------------

export function createEditRepoFileTool(repoRoot: string): ToolDefinition {
  return {
    description: 'Replace a specific substring in a repo file in place (preserves everything else). Use this instead of write_repo_file for small edits to large files — it saves context tokens and avoids accidentally dropping content. By default old_string must match EXACTLY ONE occurrence; set allow_multiple=true to replace every occurrence.',
    parameters: z.object({
      path: z.string().min(1).describe('File path relative to repo root.'),
      old_string: z.string().min(1).describe('Exact text to find. Include enough surrounding context to uniquely identify the target.'),
      new_string: z.string().describe('Replacement text.'),
      allow_multiple: z.boolean().default(false).describe('Replace every occurrence (default false → exactly one occurrence required)'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(
      params: {path: string; old_string: string; new_string: string; allow_multiple?: boolean},
      _ctx: ToolContext,
    ): Promise<unknown> {
      const validation = validatePath(repoRoot, params.path);
      if ('error' in validation) return {error: validation.error};
      if (isReadOnlyPath(validation.relative)) {
        return {error: `${validation.relative} is read-only (installed package)`};
      }

      let original: string;
      try {
        original = await readFile(validation.resolved, 'utf-8');
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
        const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        return {error: isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err))};
      }

      const allowMultiple = params.allow_multiple ?? false;

      // Count occurrences with a non-regex scan so the agent doesn't have
      // to escape special characters in old_string.
      const occurrences = countOccurrences(original, params.old_string);
      if (occurrences === 0) {
        return {error: `No occurrences of old_string found in ${validation.relative}. Verify whitespace, indentation, and surrounding context match exactly.`};
      }
      if (!allowMultiple && occurrences > 1) {
        return {error: `Found ${String(occurrences)} occurrences of old_string in ${validation.relative}, expected exactly 1. Either add more surrounding context to uniquely identify the target, or set allow_multiple=true to replace all.`};
      }

      const updated = allowMultiple
        ? original.split(params.old_string).join(params.new_string)
        : original.replace(params.old_string, params.new_string);

      await writeFile(validation.resolved, updated, 'utf-8');
      return {
        edited: validation.relative,
        occurrences,
        bytes_before: original.length,
        bytes_after: updated.length,
      };
    },
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// read_many_repo_files
// ---------------------------------------------------------------------------

export function createReadManyRepoFilesTool(repoRoot: string): ToolDefinition {
  return {
    description: `Read multiple files from the agent repo in one call. Returns a structured array of {path, content} entries. Capped at ${String(READ_MANY_MAX_FILES)} files per call; each file truncated to ${String(READ_MANY_MAX_BYTES)} bytes (use read_repo_file for the full content of a truncated file). Use this when you need to compare/review several files together (e.g. "read every SKILL.md").`,
    parameters: z.object({
      paths: z.array(z.string().min(1)).min(1).describe('Array of file paths relative to repo root. Each must be in an allowed directory.'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {paths: string[]}, _ctx: ToolContext): Promise<unknown> {
      const requested = params.paths.slice(0, READ_MANY_MAX_FILES);
      const excess = params.paths.length - requested.length;

      const files: Array<{
        path: string;
        content?: string;
        total_lines?: number;
        truncated?: boolean;
        error?: string;
      }> = [];

      for (const p of requested) {
        const validation = validatePath(repoRoot, p);
        if ('error' in validation) {
          files.push({path: p, error: validation.error});
          continue;
        }
        let buf: Buffer;
        try {
          buf = await readFile(validation.resolved);
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded by instanceof + 'code' in err
          const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
          files.push({
            path: validation.relative,
            error: isNotFound ? `File not found: ${validation.relative}` : (err instanceof Error ? err.message : String(err)),
          });
          continue;
        }
        if (isLikelyBinary(buf)) {
          files.push({path: validation.relative, error: 'Binary file — not returned'});
          continue;
        }
        // Count lines in the ORIGINAL file (not the truncated content) so
        // the agent knows how much more there is when content is truncated.
        // READ_MANY_MAX_BYTES is a byte budget, so slice bytes then decode
        // (may emit U+FFFD on a mid-multibyte cut — acceptable, matches
        // previous behavior).
        const fullText = buf.toString('utf-8');
        const totalLines = countLines(fullText);
        const truncated = buf.length > READ_MANY_MAX_BYTES;
        const content = truncated
          ? buf.subarray(0, READ_MANY_MAX_BYTES).toString('utf-8')
          : fullText;
        files.push({
          path: validation.relative,
          content,
          total_lines: totalLines,
          ...(truncated ? {truncated: true} : {}),
        });
      }

      return {files, ...(excess > 0 ? {truncated: true, dropped: excess} : {})};
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
  registry.register('edit_repo_file', createEditRepoFileTool(repoRoot));
  registry.register('delete_repo_file', createDeleteRepoFileTool(repoRoot));
  registry.register('list_repo_files', createListRepoFilesTool(repoRoot));
  registry.register('glob_repo_files', createGlobRepoFilesTool(repoRoot));
  registry.register('grep_repo_files', createGrepRepoFilesTool(repoRoot));
  registry.register('read_many_repo_files', createReadManyRepoFilesTool(repoRoot));
  registry.register('internal_api', createInternalApiTool(getPort));
}
