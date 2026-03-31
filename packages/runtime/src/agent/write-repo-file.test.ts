/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {AgentSession} from './agent-types.js';
import {
  isAllowedRepoPath,
  validateRepoFilePath,
  executeWriteRepoFile,
  executeReadRepoFile,
} from './agent-runner.js';

function makeAdminSession(repoOrigin: string): AgentSession {
  return {
    id: 'session-1',
    appId: 'admin',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    runtime: {
      repo: {
        source: 'local',
        origin: repoOrigin,
        config: {
          name: 'test',
          version: '1.0.0',
          models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
        },
        connections: new Map(),
        skills: [],
        agents: {},
        automations: [],
        knowledge: [],
        evals: [],
        tools: [],
        stores: [],
      },
      compiledContext: {
        systemPrompt: 'Admin agent.',
        tokenUsage: {total: 100000, used: 100, remaining: 99900, sectionBreakdown: {}},
        sections: [],
      },
      exploreContext: {
        systemPrompt: 'Explore.',
        tokenUsage: {total: 100000, used: 100, remaining: 99900, sectionBreakdown: {}},
        sections: [],
      },
      outputPipeline: {process: (t: string) => ({output: t, modified: false, blocked: false, findings: []})},
      telemetry: {logGuard: () => {}},
    },
    planModeManager: {isActive: () => false, getStatus: () => ({active: false})},
  } as unknown as AgentSession;
}

function makeNonAdminSession(repoOrigin: string): AgentSession {
  const session = makeAdminSession(repoOrigin);
  return {...session, appId: 'app-1'} as unknown as AgentSession;
}

describe('isAllowedRepoPath', () => {
  it('allows skills/ paths', () => {
    expect(isAllowedRepoPath('skills/triage/SKILL.md')).toBe(true);
    expect(isAllowedRepoPath('skills/new-skill/SKILL.md')).toBe(true);
  });

  it('allows knowledge/ paths', () => {
    expect(isAllowedRepoPath('knowledge/formatting-rules.md')).toBe(true);
    expect(isAllowedRepoPath('knowledge/deep/nested/doc.md')).toBe(true);
  });

  it('allows connections/*/rules.md', () => {
    expect(isAllowedRepoPath('connections/slack/rules.md')).toBe(true);
  });

  it('allows connections/*/surface.md', () => {
    expect(isAllowedRepoPath('connections/github/surface.md')).toBe(true);
  });

  it('allows connections/*/entities.md', () => {
    expect(isAllowedRepoPath('connections/stripe/entities.md')).toBe(true);
  });

  it('rejects top-level files', () => {
    expect(isAllowedRepoPath('amodal.json')).toBe(false);
    expect(isAllowedRepoPath('package.json')).toBe(false);
  });

  it('rejects src/ paths', () => {
    expect(isAllowedRepoPath('src/index.ts')).toBe(false);
  });

  it('rejects connections/*/spec.json', () => {
    expect(isAllowedRepoPath('connections/slack/spec.json')).toBe(false);
  });

  it('rejects connections/*/access.json', () => {
    expect(isAllowedRepoPath('connections/slack/access.json')).toBe(false);
  });
});

describe('validateRepoFilePath', () => {
  it('rejects absolute paths', () => {
    const session = makeAdminSession('/tmp/repo');
    const result = validateRepoFilePath(session, '/etc/passwd');
    expect(result).toHaveProperty('error');
    expect((result as {error: string}).error).toContain('relative');
  });

  it('rejects path traversal', () => {
    const session = makeAdminSession('/tmp/repo');
    const result = validateRepoFilePath(session, '../../etc/passwd');
    expect(result).toHaveProperty('error');
    expect((result as {error: string}).error).toContain('traversal');
  });

  it('rejects non-admin sessions', () => {
    const session = makeNonAdminSession('/tmp/repo');
    const result = validateRepoFilePath(session, 'knowledge/foo.md');
    expect(result).toHaveProperty('error');
    expect((result as {error: string}).error).toContain('admin');
  });

  it('rejects disallowed directories', () => {
    const session = makeAdminSession('/tmp/repo');
    const result = validateRepoFilePath(session, 'src/index.ts');
    expect(result).toHaveProperty('error');
    expect((result as {error: string}).error).toContain('not in an allowed directory');
  });

  it('accepts valid knowledge path', () => {
    const session = makeAdminSession('/tmp/repo');
    const result = validateRepoFilePath(session, 'knowledge/formatting-rules.md');
    expect(result).toHaveProperty('resolved');
    expect((result as {resolved: string}).resolved).toBe(path.resolve('/tmp/repo', 'knowledge/formatting-rules.md'));
  });
});

describe('executeWriteRepoFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'amodal-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('writes a knowledge file', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'knowledge/no-em-dashes.md',
      content: '# Formatting Rules\n\nNever use em dashes in output.',
    });
    expect(result.output).toContain('Wrote knowledge/no-em-dashes.md');
    const written = await readFile(path.join(tmpDir, 'knowledge/no-em-dashes.md'), 'utf-8');
    expect(written).toContain('Never use em dashes');
  });

  it('writes a skill file with nested directories', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'skills/formatting/SKILL.md',
      content: '# Formatting Skill',
    });
    expect(result.output).toContain('Wrote skills/formatting/SKILL.md');
  });

  it('rejects writes to disallowed paths', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'src/index.ts',
      content: 'console.log("pwned")',
    });
    expect(result.error).toContain('not in an allowed directory');
  });

  it('rejects empty content', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'knowledge/test.md',
      content: '',
    });
    expect(result.error).toContain('empty');
  });

  it('rejects path traversal', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: '../../../etc/passwd',
      content: 'bad',
    });
    expect(result.error).toContain('traversal');
  });
});

describe('executeReadRepoFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'amodal-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('reads an existing knowledge file', async () => {
    const session = makeAdminSession(tmpDir);
    // Write a file first
    await executeWriteRepoFile(session, {
      path: 'knowledge/test.md',
      content: 'Test content here.',
    });
    const result = await executeReadRepoFile(session, {path: 'knowledge/test.md'});
    expect(result.output).toBe('Test content here.');
  });

  it('returns error for missing file', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeReadRepoFile(session, {path: 'knowledge/missing.md'});
    expect(result.error).toContain('not found');
  });

  it('rejects reads from disallowed paths', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeReadRepoFile(session, {path: 'package.json'});
    expect(result.error).toContain('not in an allowed directory');
  });
});
