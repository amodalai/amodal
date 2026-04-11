/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGLiteStudioBackend, NotImplementedStudioBackend} from '@amodalai/studio';
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
  DEFAULT_ADMIN_AGENT_USER_ID,
  LIST_MAX_ENTRIES,
  GREP_MAX_MATCHES,
  READ_MANY_MAX_FILES,
  READ_MANY_MAX_BYTES,
  READ_FILE_DEFAULT_LINES,
} from './admin-file-tools.js';
import {createToolRegistry} from './registry.js';
import {ConfigError} from '../errors.js';
import type {ToolContext} from './types.js';

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
};

let repoRoot: string;
let backend: PGLiteStudioBackend;
const TEST_USER_ID = DEFAULT_ADMIN_AGENT_USER_ID;

beforeEach(async () => {
  repoRoot = mkdtempSync(join(tmpdir(), 'admin-tools-test-'));
  mkdirSync(join(repoRoot, 'skills'), {recursive: true});
  mkdirSync(join(repoRoot, 'knowledge'), {recursive: true});
  mkdirSync(join(repoRoot, 'evals'), {recursive: true});
  mkdirSync(join(repoRoot, 'node_modules', 'test-pkg'), {recursive: true});
  // In-memory pglite backend — no dataDir, no pre-built pglite instance.
  backend = new PGLiteStudioBackend({repoPath: repoRoot});
  await backend.init();
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
    expect(isAllowedRepoPath('dist/bundle.js')).toBe(false);
  });

  it('allows node_modules as read-only', () => {
    expect(isAllowedRepoPath('node_modules/@amodalai/foo/skills/bar.md')).toBe(true);
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

  // -------------------------------------------------------------------------
  // Pagination + line metadata
  // -------------------------------------------------------------------------

  it('returns line_start, line_end, total_lines for a short file', async () => {
    writeFileSync(join(repoRoot, 'skills', 'short.md'), 'one\ntwo\nthree');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/short.md'}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('one\ntwo\nthree');
    expect(result['line_start']).toBe(1);
    expect(result['line_end']).toBe(3);
    expect(result['total_lines']).toBe(3);
    expect(result['truncated']).toBeUndefined();
  });

  it("doesn't count the trailing empty line from a final newline", async () => {
    // "a\nb\n" is 2 lines to humans, not 3.
    writeFileSync(join(repoRoot, 'skills', 'trailing.md'), 'a\nb\n');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/trailing.md'}, mockCtx) as Record<string, unknown>;
    expect(result['total_lines']).toBe(2);
  });

  it('truncates at the default cap and sets truncated=true', async () => {
    // Build a file with READ_FILE_DEFAULT_LINES + 100 lines.
    const body = Array.from({length: READ_FILE_DEFAULT_LINES + 100}, (_, i) => `line-${String(i)}`).join('\n');
    writeFileSync(join(repoRoot, 'skills', 'long.md'), body);
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/long.md'}, mockCtx) as Record<string, unknown>;

    expect(result['line_start']).toBe(1);
    expect(result['line_end']).toBe(READ_FILE_DEFAULT_LINES);
    expect(result['total_lines']).toBe(READ_FILE_DEFAULT_LINES + 100);
    expect(result['truncated']).toBe(true);
    const lines = String(result['content']).split('\n');
    expect(lines).toHaveLength(READ_FILE_DEFAULT_LINES);
    expect(lines[0]).toBe('line-0');
    expect(lines[lines.length - 1]).toBe(`line-${String(READ_FILE_DEFAULT_LINES - 1)}`);
  });

  it('honors offset to start reading from a specific line (1-indexed)', async () => {
    writeFileSync(join(repoRoot, 'skills', 'nums.md'), 'a\nb\nc\nd\ne');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/nums.md', offset: 3}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('c\nd\ne');
    expect(result['line_start']).toBe(3);
    expect(result['line_end']).toBe(5);
    expect(result['total_lines']).toBe(5);
  });

  it('honors limit to cap the returned line count', async () => {
    writeFileSync(join(repoRoot, 'skills', 'nums.md'), 'a\nb\nc\nd\ne');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/nums.md', limit: 2}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('a\nb');
    expect(result['line_start']).toBe(1);
    expect(result['line_end']).toBe(2);
    expect(result['total_lines']).toBe(5);
    expect(result['truncated']).toBe(true);
  });

  it('supports offset + limit together to read a middle window', async () => {
    writeFileSync(join(repoRoot, 'skills', 'nums.md'), 'a\nb\nc\nd\ne\nf\ng');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/nums.md', offset: 3, limit: 3}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('c\nd\ne');
    expect(result['line_start']).toBe(3);
    expect(result['line_end']).toBe(5);
    expect(result['truncated']).toBe(true); // line_end(5) < total_lines(7)
  });

  it('returns empty content with line_end = offset - 1 when offset is past EOF', async () => {
    writeFileSync(join(repoRoot, 'skills', 'nums.md'), 'a\nb\nc');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/nums.md', offset: 100}, mockCtx) as Record<string, unknown>;

    expect(result['content']).toBe('');
    expect(result['line_start']).toBe(100);
    // line_end < line_start signals "empty range — caller asked past EOF"
    expect(result['line_end']).toBe(99);
    expect(result['total_lines']).toBe(3);
    // Not truncated: there's nothing more to give.
    expect(result['truncated']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Pagination fencepost cases
  // -------------------------------------------------------------------------

  it('does NOT mark truncated when file is exactly at the default cap', async () => {
    const body = Array.from({length: READ_FILE_DEFAULT_LINES}, (_, i) => `x${String(i)}`).join('\n');
    writeFileSync(join(repoRoot, 'skills', 'exact.md'), body);
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/exact.md'}, mockCtx) as Record<string, unknown>;
    expect(result['total_lines']).toBe(READ_FILE_DEFAULT_LINES);
    expect(result['line_end']).toBe(READ_FILE_DEFAULT_LINES);
    expect(result['truncated']).toBeUndefined();
  });

  it('marks truncated when file is exactly one line over the default cap', async () => {
    const body = Array.from({length: READ_FILE_DEFAULT_LINES + 1}, (_, i) => `x${String(i)}`).join('\n');
    writeFileSync(join(repoRoot, 'skills', 'over.md'), body);
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/over.md'}, mockCtx) as Record<string, unknown>;
    expect(result['total_lines']).toBe(READ_FILE_DEFAULT_LINES + 1);
    expect(result['line_end']).toBe(READ_FILE_DEFAULT_LINES);
    expect(result['truncated']).toBe(true);
  });

  it('handles an empty file', async () => {
    writeFileSync(join(repoRoot, 'skills', 'empty.md'), '');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/empty.md'}, mockCtx) as Record<string, unknown>;
    expect(result['content']).toBe('');
    expect(result['total_lines']).toBe(0);
    expect(result['line_start']).toBe(1);
    expect(result['line_end']).toBe(0); // empty range
    expect(result['truncated']).toBeUndefined();
  });

  it('counts CRLF line endings correctly', async () => {
    writeFileSync(join(repoRoot, 'skills', 'crlf.md'), 'a\r\nb\r\nc\r\n');
    const tool = createReadRepoFileTool(repoRoot);

    const result = await tool.execute({path: 'skills/crlf.md'}, mockCtx) as Record<string, unknown>;
    expect(result['total_lines']).toBe(3);
    expect(result['content']).toBe('a\nb\nc');
  });

  it('rejects binary files', async () => {
    // Write a buffer with a NUL byte in it (classic binary signal).
    writeFileSync(join(repoRoot, 'skills', 'binary.bin'), Buffer.from([0x48, 0x65, 0x00, 0x6C, 0x6C, 0x6F]));
    const tool = createReadRepoFileTool(repoRoot);

    // "binary.bin" still lives under skills/ so it passes the path validator.
    const result = await tool.execute({path: 'skills/binary.bin'}, mockCtx) as Record<string, unknown>;
    expect(result['error']).toContain('Binary');
  });
});

describe('createWriteRepoFileTool', () => {
  it('stages a new file as a draft (does not touch disk)', async () => {
    const tool = createWriteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'knowledge/rules.md', content: '# Rules'}, mockCtx) as Record<string, unknown>;

    expect(result['written']).toBe('knowledge/rules.md');
    expect(result['bytes']).toBe(7);
    expect(result['staged']).toBe(true);

    // Disk must NOT have been written — drafts are pre-commit state.
    expect(existsSync(join(repoRoot, 'knowledge', 'rules.md'))).toBe(false);

    // Backend must have a draft row for this (user, path).
    const draft = await backend.getDraft(TEST_USER_ID, 'knowledge/rules.md');
    expect(draft).toBe('# Rules');
  });

  it('isolates drafts by userId', async () => {
    const toolAlice = createWriteRepoFileTool(repoRoot, backend, 'alice');
    const toolBob = createWriteRepoFileTool(repoRoot, backend, 'bob');
    await toolAlice.execute({path: 'skills/s.md', content: 'from-alice'}, mockCtx);
    await toolBob.execute({path: 'skills/s.md', content: 'from-bob'}, mockCtx);

    expect(await backend.getDraft('alice', 'skills/s.md')).toBe('from-alice');
    expect(await backend.getDraft('bob', 'skills/s.md')).toBe('from-bob');
  });

  it('overwrites an existing draft on a second write', async () => {
    const tool = createWriteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    await tool.execute({path: 'knowledge/rules.md', content: 'first'}, mockCtx);
    await tool.execute({path: 'knowledge/rules.md', content: 'second'}, mockCtx);

    expect(await backend.getDraft(TEST_USER_ID, 'knowledge/rules.md')).toBe('second');
  });

  it('rejects writes to read-only directories', async () => {
    const tool = createWriteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'node_modules/test-pkg/file.ts', content: 'code'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
    // And no draft should have been staged.
    expect(await backend.getDraft(TEST_USER_ID, 'node_modules/test-pkg/file.ts')).toBeNull();
  });

  it('rejects blocked filenames without staging a draft', async () => {
    const tool = createWriteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'skills/.env', content: 'SECRET=x'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toBeDefined();
    expect(await backend.getDraft(TEST_USER_ID, 'skills/.env')).toBeNull();
  });

  it('is not readOnly', () => {
    const tool = createWriteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    expect(tool.readOnly).toBe(false);
  });

  it('surfaces backend errors loudly (no silent swallow)', async () => {
    // NotImplementedStudioBackend throws on every mutation — matches the
    // PR 2.7 "missing backend is a configuration bug, surface it" contract.
    const tool = createWriteRepoFileTool(repoRoot, new NotImplementedStudioBackend(), TEST_USER_ID);
    await expect(
      tool.execute({path: 'skills/x.md', content: 'y'}, mockCtx),
    ).rejects.toThrow(/not implemented/i);
  });
});

describe('createDeleteRepoFileTool', () => {
  it('drops a pending draft and does NOT unlink the base file on disk', async () => {
    // Base file exists on disk AND we have a pending draft for the same path.
    writeFileSync(join(repoRoot, 'evals', 'old-test.md'), 'base-content');
    await backend.setDraft(TEST_USER_ID, 'evals/old-test.md', 'draft-content');

    const tool = createDeleteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'evals/old-test.md'}, mockCtx) as Record<string, unknown>;

    expect(result['deleted']).toBe('evals/old-test.md');
    expect(result['draft_reverted']).toBe(true);

    // Draft is gone.
    expect(await backend.getDraft(TEST_USER_ID, 'evals/old-test.md')).toBeNull();

    // But the base file is still on disk — delete_repo_file is "revert
    // this pending edit", NOT "remove from git".
    expect(existsSync(join(repoRoot, 'evals', 'old-test.md'))).toBe(true);
    expect(readFileSync(join(repoRoot, 'evals', 'old-test.md'), 'utf-8')).toBe('base-content');
  });

  it('is idempotent — deleting a non-existent draft succeeds', async () => {
    const tool = createDeleteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'evals/nothing-here.md'}, mockCtx) as Record<string, unknown>;

    expect(result['deleted']).toBe('evals/nothing-here.md');
  });

  it('rejects deletes in read-only directories', async () => {
    const tool = createDeleteRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute({path: 'node_modules/test-pkg/file.ts'}, mockCtx) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
  });

  it('surfaces backend errors loudly', async () => {
    const tool = createDeleteRepoFileTool(repoRoot, new NotImplementedStudioBackend(), TEST_USER_ID);
    await expect(
      tool.execute({path: 'skills/x.md'}, mockCtx),
    ).rejects.toThrow(/not implemented/i);
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
    registerAdminFileTools(registry, repoRoot, () => 3000, {backend, userId: TEST_USER_ID});

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

  it('accepts the pre-PR-2.7 three-arg signature and defaults backend to NotImplementedStudioBackend', async () => {
    // Backward-compat call site (e.g. session/session-builder.ts) still uses
    // the three-arg form. Registration itself must not throw — the throw
    // only happens at mutation time when the default backend is invoked.
    const registry = createToolRegistry();
    registerAdminFileTools(registry, repoRoot, () => 3000);
    expect(registry.size).toBe(9);

    const writeTool = registry.get('write_repo_file');
    expect(writeTool).toBeDefined();
    await expect(
      writeTool!.execute({path: 'skills/x.md', content: 'y'}, mockCtx),
    ).rejects.toThrow(/not implemented/i);
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
  it('replaces a single unique occurrence, stages as draft, and leaves disk untouched', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), '# hello\n\nworld');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'hello', new_string: 'hi'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['edited']).toBe('skills/a.md');
    expect(result['occurrences']).toBe(1);
    expect(result['staged']).toBe(true);

    // Disk unchanged — the edit went to the draft layer.
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('# hello\n\nworld');
    // Draft contains the edited content.
    expect(await backend.getDraft(TEST_USER_ID, 'skills/a.md')).toBe('# hi\n\nworld');
  });

  it('reads with draft overlay so back-to-back edits compose', async () => {
    // Base file has "alpha beta gamma". First edit → "ALPHA beta gamma".
    // Second edit must see the result of the first (not the base file),
    // otherwise it would silently overwrite the first edit.
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'alpha beta gamma');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    await tool.execute(
      {path: 'skills/a.md', old_string: 'alpha', new_string: 'ALPHA'},
      mockCtx,
    );
    const result2 = await tool.execute(
      {path: 'skills/a.md', old_string: 'beta', new_string: 'BETA'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result2['edited']).toBe('skills/a.md');
    // Draft should now have BOTH edits applied — this proves the overlay
    // read path is wired up correctly.
    expect(await backend.getDraft(TEST_USER_ID, 'skills/a.md')).toBe('ALPHA BETA gamma');
  });

  it('fails when old_string is not found (and does not stage a draft)', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), '# hello');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'missing', new_string: 'x'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('No occurrences');
    expect(await backend.getDraft(TEST_USER_ID, 'skills/a.md')).toBeNull();
  });

  it('fails when old_string appears multiple times and allow_multiple is false', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'foo foo foo');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'foo', new_string: 'bar'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('Found 3 occurrences');
    // Neither disk nor draft should be touched.
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('foo foo foo');
    expect(await backend.getDraft(TEST_USER_ID, 'skills/a.md')).toBeNull();
  });

  it('replaces every occurrence when allow_multiple=true (staged as a draft)', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'foo foo foo');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    const result = await tool.execute(
      {path: 'skills/a.md', old_string: 'foo', new_string: 'bar', allow_multiple: true},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['occurrences']).toBe(3);
    // Draft has the rewrite; disk still has the original.
    expect(await backend.getDraft(TEST_USER_ID, 'skills/a.md')).toBe('bar bar bar');
    expect(readFileSync(join(repoRoot, 'skills', 'a.md'), 'utf-8')).toBe('foo foo foo');
  });

  it('rejects edits to read-only directories', async () => {
    writeFileSync(join(repoRoot, 'node_modules', 'test-pkg', 'file.ts'), 'code');
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);

    const result = await tool.execute(
      {path: 'node_modules/test-pkg/file.ts', old_string: 'code', new_string: 'new'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('read-only');
  });

  it('returns "File not found" when neither disk nor draft has the file', async () => {
    const tool = createEditRepoFileTool(repoRoot, backend, TEST_USER_ID);
    const result = await tool.execute(
      {path: 'skills/ghost.md', old_string: 'x', new_string: 'y'},
      mockCtx,
    ) as Record<string, unknown>;

    expect(result['error']).toContain('File not found');
  });
});

// ---------------------------------------------------------------------------
// read_many_repo_files
// ---------------------------------------------------------------------------

describe('createReadManyRepoFilesTool', () => {
  it('reads multiple files into a structured array with total_lines', async () => {
    writeFileSync(join(repoRoot, 'skills', 'a.md'), 'line1\nline2\nline3');
    writeFileSync(join(repoRoot, 'knowledge', 'b.md'), 'only-line');
    const tool = createReadManyRepoFilesTool(repoRoot);

    const result = await tool.execute(
      {paths: ['skills/a.md', 'knowledge/b.md']},
      mockCtx,
    ) as {files: Array<{path: string; content?: string; total_lines?: number; error?: string}>};

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({path: 'skills/a.md', content: 'line1\nline2\nline3', total_lines: 3});
    expect(result.files[1]).toMatchObject({path: 'knowledge/b.md', content: 'only-line', total_lines: 1});
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
