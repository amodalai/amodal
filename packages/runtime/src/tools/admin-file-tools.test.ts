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
  registerAdminFileTools,
  isAllowedRepoPath,
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
  it('registers all 4 admin tools', () => {
    const registry = createToolRegistry();
    registerAdminFileTools(registry, repoRoot, () => 3000);

    expect(registry.names()).toEqual([
      'read_repo_file',
      'write_repo_file',
      'delete_repo_file',
      'internal_api',
    ]);
    expect(registry.size).toBe(4);
  });
});
