/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtemp, rm, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {AgentSession} from './agent-types.js';
import {
  isAllowedRepoPath,
  validateRepoFilePath,
  executeWriteRepoFile,
  executeReadRepoFile,
  executeDeleteRepoFile,
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

  it('allows connections/ paths', () => {
    expect(isAllowedRepoPath('connections/slack/rules.md')).toBe(true);
    expect(isAllowedRepoPath('connections/github/surface.md')).toBe(true);
    expect(isAllowedRepoPath('connections/stripe/entities.md')).toBe(true);
    expect(isAllowedRepoPath('connections/slack/spec.json')).toBe(true);
    expect(isAllowedRepoPath('connections/slack/access.json')).toBe(true);
  });

  it('allows pages/ paths', () => {
    expect(isAllowedRepoPath('pages/dashboard.tsx')).toBe(true);
    expect(isAllowedRepoPath('pages/price-tracker.tsx')).toBe(true);
  });

  it('allows automations/ paths', () => {
    expect(isAllowedRepoPath('automations/daily-digest.json')).toBe(true);
  });

  it('allows stores/ paths', () => {
    expect(isAllowedRepoPath('stores/price-data.json')).toBe(true);
  });

  it('allows tools/ paths', () => {
    expect(isAllowedRepoPath('tools/fetch-prices/tool.json')).toBe(true);
    expect(isAllowedRepoPath('tools/fetch-prices/handler.ts')).toBe(true);
  });

  it('allows evals/ paths', () => {
    expect(isAllowedRepoPath('evals/triage-accuracy.md')).toBe(true);
  });

  it('allows agents/ paths', () => {
    expect(isAllowedRepoPath('agents/explore/AGENT.md')).toBe(true);
  });

  it('rejects top-level files', () => {
    expect(isAllowedRepoPath('amodal.json')).toBe(false);
    expect(isAllowedRepoPath('package.json')).toBe(false);
  });

  it('rejects src/ paths', () => {
    expect(isAllowedRepoPath('src/index.ts')).toBe(false);
  });

  it('rejects .env', () => {
    expect(isAllowedRepoPath('.env')).toBe(false);
  });

  it('rejects blocked filenames even inside allowed dirs', () => {
    expect(isAllowedRepoPath('tools/.env')).toBe(false);
    expect(isAllowedRepoPath('pages/amodal.json')).toBe(false);
    expect(isAllowedRepoPath('skills/package.json')).toBe(false);
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

  it('writes a page file', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'pages/price-dashboard.tsx',
      content: 'export default function PriceDashboard() { return <div>Prices</div>; }',
    });
    expect(result.output).toContain('Wrote pages/price-dashboard.tsx');
  });

  it('writes an automation file', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeWriteRepoFile(session, {
      path: 'automations/fetch-prices.json',
      content: JSON.stringify({ title: 'Fetch Prices', schedule: '0 * * * *', prompt: 'Fetch latest prices' }),
    });
    expect(result.output).toContain('Wrote automations/fetch-prices.json');
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

describe('executeDeleteRepoFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'amodal-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('deletes an existing file', async () => {
    const session = makeAdminSession(tmpDir);
    await executeWriteRepoFile(session, {
      path: 'evals/old-test.md',
      content: 'old eval',
    });
    const result = await executeDeleteRepoFile(session, {path: 'evals/old-test.md'});
    expect(result.output).toContain('Deleted evals/old-test.md');
    await expect(stat(path.join(tmpDir, 'evals/old-test.md'))).rejects.toThrow();
  });

  it('returns error for missing file', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeDeleteRepoFile(session, {path: 'evals/nonexistent.md'});
    expect(result.error).toContain('not found');
  });

  it('rejects deletes from disallowed paths', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeDeleteRepoFile(session, {path: 'package.json'});
    expect(result.error).toContain('not in an allowed directory');
  });

  it('rejects path traversal', async () => {
    const session = makeAdminSession(tmpDir);
    const result = await executeDeleteRepoFile(session, {path: '../../etc/passwd'});
    expect(result.error).toContain('traversal');
  });
});
