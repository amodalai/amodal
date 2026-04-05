/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  createReadRepoFileTool,
  createWriteRepoFileTool,
  createDeleteRepoFileTool,
  createInternalApiTool,
  createListRepoFilesTool,
  createGlobRepoFilesTool,
  createGrepRepoFilesTool,
  createEditRepoFileTool,
  createReadManyRepoFilesTool,
  registerAdminFileTools,
  isAllowedRepoPath,
  LIST_MAX_ENTRIES,
  GREP_MAX_MATCHES,
  READ_MANY_MAX_FILES,
  READ_MANY_MAX_BYTES,
} from './admin-file-tools.js';
import {createToolRegistry} from './registry.js';
import {ConfigError} from '../errors.js';
import type {ToolContext} from './types.js';

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  user: {roles: ['admin']},
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'admin-tools-test-'));
  mkdirSync(join(repoRoot, 'skills'), {recursive: true});
  mkdirSync(join(repoRoot, 'knowledge'), {recursive: true});
  mkdirSync(join(repoRoot, 'evals'), {recursive: true});
  mkdirSync(join(repoRoot, 'amodal_packages', 'test-pkg'), {recursive: true});
});

afterEach(() => {
  rmSync(repoRoot, {recursive: true, force: true});
});

describe('isAllowedRepoPath', () => {
  it('allows paths in permitted directories', () => {
    expect(isAllowedRepoPath('skills/triage.md')).toBe(true);
    expect(isAllowedRepoPath('knowledge/rules.md')).toBe(true);
    expect(isAllowedRepoPath('connections/typefully/spec.json')).toBe(true);
    expect(isAllowedRepoPath('stores/alerts.json')).toBe(true);
    expect(isAllowedRepoPath('tools/my_tool/handler.ts')).toBe(true);
  });

  it('blocks sensitive files', () => {
    expect(isAllowedRepoPath('.env')).toBe(false);
    expect(isAllowedRepoPath('amodal.json')).toBe(false);
    expect(isAllowedRepoPath('package.json')).toBe(false);
  });

  it('blocks paths outside allowed directories', () => {
    expect(isAllowedRepoPath('src/index.ts')).toBe(false);
    expect(isAllowedRepoPath('node_modules/foo')).toBe(false);
  });
});

describe('createReadRepoFileTool', () => {
  it('reads an existing file', async () => {
    writeFileSync(join(repoRoot, 'skills', 'triage.md'), '# Triage Skill');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/triage.md'}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('# Triage Skill');
    expect(result['path']).toBe('skills/triage.md');
  });

  it('returns error for missing file', async () => {
    const tool = createReadRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'skills/nonexistent.md'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('File not found');
  });

  it('rejects path traversal', async () => {
    const tool = createReadRepoFileTool(repoRoot);
    const result = await tool.execute({path: '../../../etc/passwd'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('traversal');
  });

  it('rejects absolute paths', async () => {
    const tool = createReadRepoFileTool(repoRoot);
    const result = await tool.execute({path: '/etc/passwd'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('relative');
  });

  it('rejects blocked filenames', async () => {
    const tool = createReadRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'skills/.env'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('not in an allowed directory');
  });

  it('is readOnly', () => {
    const tool = createReadRepoFileTool(repoRoot);
    expect(tool.readOnly).toBe(true);
    expect(tool.metadata?.category).toBe('admin');
  });
});

describe('createWriteRepoFileTool', () => {
  it('writes a new file', async () => {
    const tool = createWriteRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'knowledge/rules.md', content: '# Rules'}, mockCtx) as Record<string, unknown>;

    expect(result['written']).toBe('knowledge/rules.md');
    expect(result['bytes']).toBe(7);
    expect(readFileSync(join(repoRoot, 'knowledge', 'rules.md'), 'utf-8')).toBe('# Rules');
  });

  it('creates parent directories', async () => {
    const tool = createWriteRepoFileTool(repoRoot);
    await tool.execute({path: 'connections/new-api/spec.json', content: '{}'}, mockCtx);

    expect(existsSync(join(repoRoot, 'connections', 'new-api', 'spec.json'))).toBe(true);
  });

  it('rejects writes to read-only directories', async () => {
    const tool = createWriteRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'amodal_packages/test-pkg/file.ts', content: 'code'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
  });

  it('is not readOnly', () => {
    const tool = createWriteRepoFileTool(repoRoot);
    expect(tool.readOnly).toBe(false);
  });
});

describe('createDeleteRepoFileTool', () => {
  it('deletes an existing file', async () => {
    writeFileSync(join(repoRoot, 'evals', 'old-test.md'), 'old');
    const tool = createDeleteRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'evals/old-test.md'}, mockCtx) as Record<string, unknown>;

    expect(result['deleted']).toBe('evals/old-test.md');
    expect(existsSync(join(repoRoot, 'evals', 'old-test.md'))).toBe(false);
  });

  it('returns error for missing file', async () => {
    const tool = createDeleteRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'evals/nonexistent.md'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('File not found');
  });

  it('rejects deletes in read-only directories', async () => {
    const tool = createDeleteRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'amodal_packages/test-pkg/file.ts'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
  });
});

describe('createInternalApiTool', () => {
  it('throws ConfigError when server not ready', async () => {
    const tool = createInternalApiTool(() => null);

    await expect(
      tool.execute({endpoint: '/inspect/health'}, mockCtx),
    ).rejects.toThrow(ConfigError);
  });

  it('is readOnly', () => {
    const tool = createInternalApiTool(() => 3000);
    expect(tool.readOnly).toBe(true);
    expect(tool.metadata?.category).toBe('admin');
  });
});

describe('registerAdminFileTools', () => {
  it('registers all 9 admin tools', () => {
    const registry = createToolRegistry();
    registerAdminFileTools(registry, repoRoot, () => 3000);

    expect(registry.names()).toEqual([
      'read_repo_file',
      'write_repo_file',
      'edit_repo_file',
      'delete_repo_file',
      'list_repo_files',
      'glob_repo_files',
      'grep_repo_files',
      'read_many_repo_files',
      'internal_api',
    ]);
    expect(registry.size).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// list_repo_files
// ---------------------------------------------------------------------------

describe('createListRepoFilesTool', () => {
  it('lists every allowed top-level dir when "dir" is omitted', async () => {
    writeFileSync(join(repoRoot, 'skills', 'triage.md'), '# triage');
    writeFileSync(join(repoRoot, 'knowledge', 'rules.md'), '# rules');
    const tool = createListRepoFilesTool(repoRoot);

    const result = await tool.execute({}, mockCtx) as {dir: null; files: string[]};
    expect(result.dir).toBeNull();
    expect(result.files).toEqual(expect.arrayContaining(['skills/triage.md', 'knowledge/rules.md']));
  });

  it('lists a single allowlisted directory recursively', async () => {
    mkdirSync(join(repoRoot, 'skills', 'triage'), {recursive: true});
    writeFileSync(join(repoRoot, 'skills', 'triage', 'SKILL.md'), 'skill');
    writeFileSync(join(repoRoot, 'skills', 'triage', 'notes.md'), 'notes');
    const tool = createListRepoFilesTool(repoRoot);

    const result = await tool.execute({dir: 'skills'}, mockCtx) as {dir: string; files: string[]};
    expect(result.dir).toBe('skills');
    expect(result.files).toEqual(
      expect.arrayContaining(['skills/triage/SKILL.md', 'skills/triage/notes.md']),
    );
  });

  it('lists non-recursively when recursive=false', async () => {
    mkdirSync(join(repoRoot, 'skills', 'triage'), {recursive: true});
    writeFileSync(join(repoRoot, 'skills', 'triage', 'SKILL.md'), 'skill');
    writeFileSync(join(repoRoot, 'skills', 'top.md'), 'top');
    const tool = createListRepoFilesTool(repoRoot);

    const result = await tool.execute({dir: 'skills', recursive: false}, mockCtx) as {files: string[]};
    expect(result.files).toContain('skills/top.md');
    expect(result.files).not.toContain('skills/triage/SKILL.md');
  });

  it('skips node_modules / .git / .DS_Store', async () => {
    mkdirSync(join(repoRoot, 'skills', 'node_modules', 'dep'), {recursive: true});
    mkdirSync(join(repoRoot, 'skills', '.git'), {recursive: true});
    writeFileSync(join(repoRoot, 'skills', 'node_modules', 'dep', 'hide.js'), 'hidden');
    writeFileSync(join(repoRoot, 'skills', '.git', 'HEAD'), 'ref');
    writeFileSync(join(repoRoot, 'skills', 'visible.md'), '# visible');
    const tool = createListRepoFilesTool(repoRoot);

    const result = await tool.execute({dir: 'skills'}, mockCtx) as {files: string[]};
    expect(result.files).toEqual(['skills/visible.md']);
  });

  it('rejects path traversal via the dir arg', async () => {
    const tool = createListRepoFilesTool(repoRoot);
    const result = await tool.execute({dir: '../etc'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('traversal');
  });

  it('rejects dirs outside the allowlist', async () => {
    const tool = createListRepoFilesTool(repoRoot);
    const result = await tool.execute({dir: 'src'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('not in an allowed directory');
  });

  it('returns truncated=true when entries exceed the cap', async () => {
    // Write LIST_MAX_ENTRIES + 5 files to force truncation
    for (let i = 0; i < LIST_MAX_ENTRIES + 5; i++) {
      writeFileSync(join(repoRoot, 'skills', `file-${String(i).padStart(5, '0')}.md`), 'x');
    }
    const tool = createListRepoFilesTool(repoRoot);
    const result = await tool.execute({dir: 'skills'}, mockCtx) as {files: string[]; truncated?: boolean};
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(LIST_MAX_ENTRIES);
  }, 30_000);

  it('returns an empty files array for a missing directory', async () => {
    const tool = createListRepoFilesTool(repoRoot);
    const result = await tool.execute({dir: 'skills/nonexistent'}, mockCtx) as {files: string[]};
    expect(result.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// glob_repo_files
// ---------------------------------------------------------------------------

describe('createGlobRepoFilesTool', () => {
  it('finds files matching a pattern under the allowlist', async () => {
    mkdirSync(join(repoRoot, 'skills', 'a'), {recursive: true});
    mkdirSync(join(repoRoot, 'skills', 'b'), {recursive: true});
    writeFileSync(join(repoRoot, 'skills', 'a', 'SKILL.md'), 'a');
    writeFileSync(join(repoRoot, 'skills', 'b', 'SKILL.md'), 'b');
    writeFileSync(join(repoRoot, 'skills', 'a', 'notes.md'), 'a');
    const tool = createGlobRepoFilesTool(repoRoot);

    const result = await tool.execute({pattern: '**/SKILL.md'}, mockCtx) as {files: string[]};
    expect(result.files).toEqual(expect.arrayContaining(['skills/a/SKILL.md', 'skills/b/SKILL.md']));
    expect(result.files).not.toContain('skills/a/notes.md');
  });

  it('excludes paths outside the allowlist even if they match the glob', async () => {
    mkdirSync(join(repoRoot, 'not_allowed'), {recursive: true});
    writeFileSync(join(repoRoot, 'not_allowed', 'x.md'), 'x');
    writeFileSync(join(repoRoot, 'skills', 'ok.md'), 'ok');
    const tool = createGlobRepoFilesTool(repoRoot);

    const result = await tool.execute({pattern: '**/*.md'}, mockCtx) as {files: string[]};
    expect(result.files).toContain('skills/ok.md');
    expect(result.files).not.toContain('not_allowed/x.md');
  });

  it('rejects patterns containing ..', async () => {
    const tool = createGlobRepoFilesTool(repoRoot);
    const result = await tool.execute({pattern: '../**/*'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('traversal');
  });

  it('is case-insensitive by default', async () => {
    writeFileSync(join(repoRoot, 'skills', 'upper.MD'), 'x');
    const tool = createGlobRepoFilesTool(repoRoot);

    const result = await tool.execute({pattern: 'skills/*.md'}, mockCtx) as {files: string[]};
    expect(result.files).toContain('skills/upper.MD');
  });
});

// ---------------------------------------------------------------------------
// grep_repo_files
// ---------------------------------------------------------------------------

describe('createGrepRepoFilesTool', () => {
  it('returns {file, line_number, text} for each match', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'hello\nworld\nhello again');
    writeFileSync(join(repoRoot, 'skills', 'b.md'), 'world');
    const tool = createGrepRepoFilesTool(repoRoot);

    const result = await tool.execute({pattern: 'hello', dir: 'skills'}, mockCtx) as {
      matches: Array<{file: string; line_number: number; text: string}>;
    };
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({file: 'skills/a.md', line_number: 1});
    expect(result.matches[1]).toMatchObject({file: 'skills/a.md', line_number: 3});
  });

  it('supports case-sensitive search via case_insensitive=false', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'Hello\nhello');
    const tool = createGrepRepoFilesTool(repoRoot);

    const result = await tool.execute(
      {pattern: 'hello', dir: 'skills', case_insensitive: false},
      mockCtx,
    ) as {matches: Array<{line_number: number}>};
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line_number).toBe(2);
  });

  it('filters files via the include glob', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'match');
    writeFileSync(join(repoRoot, 'skills', 'a.json'), 'match');
    const tool = createGrepRepoFilesTool(repoRoot);

    const result = await tool.execute(
      {pattern: 'match', dir: 'skills', include: '*.md'},
      mockCtx,
    ) as {matches: Array<{file: string}>};
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file).toBe('skills/a.md');
  });

  it('returns an error for invalid regex', async () => {
    const tool = createGrepRepoFilesTool(repoRoot);
    const result = await tool.execute({pattern: '[invalid'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('Invalid regex');
  });

  it('caps matches at GREP_MAX_MATCHES with truncated=true', async () => {
    // Write a file with > GREP_MAX_MATCHES matching lines
    const body = Array.from({length: GREP_MAX_MATCHES + 20}, (_, i) => `match ${String(i)}`).join('\n');
    writeFileSync(join(repoRoot, 'skills', 'many.md'), body);
    const tool = createGrepRepoFilesTool(repoRoot);

    const result = await tool.execute({pattern: 'match', dir: 'skills'}, mockCtx) as {
      matches: unknown[];
      truncated?: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(GREP_MAX_MATCHES);
  });

  it('rejects directories outside the allowlist', async () => {
    const tool = createGrepRepoFilesTool(repoRoot);
    const result = await tool.execute({pattern: 'foo', dir: 'src'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('not in an allowed directory');
  });
});

// ---------------------------------------------------------------------------
// edit_repo_file
// ---------------------------------------------------------------------------

describe('createEditRepoFileTool', () => {
  it('replaces a single unique occurrence and reports stats', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), '# hello\n\nworld');
    const tool = createEditRepoFileTool(repoRoot);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'hello', new_string: 'hi'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['edited']).toBe('skills/a.md');
    expect(result['occurrences']).toBe(1);
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('# hi\n\nworld');
  });

  it('fails when old_string is not found', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), '# hello');
    const tool = createEditRepoFileTool(repoRoot);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'missing', new_string: 'x'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('No occurrences');
  });

  it('fails when old_string appears multiple times and allow_multiple is false', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'foo foo foo');
    const tool = createEditRepoFileTool(repoRoot);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'foo', new_string: 'bar'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('Found 3 occurrences');
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('foo foo foo');
  });

  it('replaces every occurrence when allow_multiple=true', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'foo foo foo');
    const tool = createEditRepoFileTool(repoRoot);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'foo', new_string: 'bar', allow_multiple: true},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['occurrences']).toBe(3);
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('bar bar bar');
  });

  it('rejects edits to read-only directories', async () => {
    writeFileSync(join(repoRoot, 'amodal_packages', 'test-pkg', 'file.ts'), 'code');
    const tool = createEditRepoFileTool(repoRoot);

    const result = await tool.execute(
      {path: 'amodal_packages/test-pkg/file.ts', old_string: 'code', new_string: 'new'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
  });
});

// ---------------------------------------------------------------------------
// read_many_repo_files
// ---------------------------------------------------------------------------

describe('createReadManyRepoFilesTool', () => {
  it('reads multiple files into a structured array', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'A');
    writeFileSync(join(repoRoot, 'knowledge', 'b.md'), 'B');
    const tool = createReadManyRepoFilesTool(repoRoot);

    const result = await tool.execute(
      {paths: ['skills/a.md', 'knowledge/b.md']},
      mockCtx,
    ) as {files: Array<{path: string; content?: string; error?: string}>};

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({path: 'skills/a.md', content: 'A'});
    expect(result.files[1]).toMatchObject({path: 'knowledge/b.md', content: 'B'});
  });

  it('returns per-file errors for disallowed paths without failing the whole call', async () => {
    writeFileSync(join(repoRoot, 'skills', 'ok.md'), 'ok');
    const tool = createReadManyRepoFilesTool(repoRoot);

    const result = await tool.execute(
      {paths: ['skills/ok.md', '../etc/passwd', '/abs/path']},
      mockCtx,
    ) as {files: Array<{path: string; content?: string; error?: string}>};

    expect(result.files).toHaveLength(3);
    expect(result.files[0].content).toBe('ok');
    expect(result.files[1].error).toContain('traversal');
    expect(result.files[2].error).toContain('relative');
  });

  it('truncates files larger than READ_MANY_MAX_BYTES', async () => {
    const big = 'x'.repeat(READ_MANY_MAX_BYTES + 100);
    writeFileSync(join(repoRoot, 'skills', 'big.md'), big);
    const tool = createReadManyRepoFilesTool(repoRoot);

    const result = await tool.execute({paths: ['skills/big.md']}, mockCtx) as {
      files: Array<{path: string; content?: string; truncated?: boolean}>;
    };
    expect(result.files[0].truncated).toBe(true);
    expect(result.files[0].content).toHaveLength(READ_MANY_MAX_BYTES);
  });

  it('caps the number of files at READ_MANY_MAX_FILES and reports the overflow', async () => {
    const paths: string[] = [];
    for (let i = 0; i < READ_MANY_MAX_FILES + 3; i++) {
      const p = `skills/f${String(i)}.md`;
      writeFileSync(join(repoRoot, 'skills', `f${String(i)}.md`), `body ${String(i)}`);
      paths.push(p);
    }
    const tool = createReadManyRepoFilesTool(repoRoot);

    const result = await tool.execute({paths}, mockCtx) as {
      files: unknown[];
      truncated?: boolean;
      dropped?: number;
    };
    expect(result.files).toHaveLength(READ_MANY_MAX_FILES);
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Bare-dir-name validator fix
// ---------------------------------------------------------------------------

describe('validatePath bare-dir error', () => {
  it('returns a directed error when read_repo_file is called on a bare allowlist dir', async () => {
    const tool = createReadRepoFileTool(repoRoot);
    const result = await tool.execute({path: 'skills'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('is a directory');
    expect(result['error']).toContain('list_repo_files');
  });
});
