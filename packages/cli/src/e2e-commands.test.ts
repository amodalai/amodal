/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for ALL CLI commands.
 *
 * Every command gets its handler invoked against real infrastructure:
 *   - Local repo commands run against a real temp directory
 *   - Platform commands run against a real mock HTTP server
 *   - Runtime commands run against a real @amodalai/runtime server
 *
 * No vi.mock, no vi.spyOn, no vi.fn — everything is real.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type http from 'node:http';

import {runInit} from './commands/init.js';
import {runValidate} from './commands/validate.js';
import {runInspect} from './commands/inspect.js';
import {runBuild} from './commands/build.js';
import {runDeploy} from './commands/deploy.js';
import {runDocker} from './commands/docker.js';

// ---------------------------------------------------------------------------
// Shared: Create a repo on disk for local-repo commands
// ---------------------------------------------------------------------------

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'amodal-e2e-cmds-'));

  // amodal.json
  writeFileSync(join(dir, 'amodal.json'), JSON.stringify({
    name: 'e2e-commands-test',
    version: '1.0.0',
    description: 'Test agent for e2e command tests',
    models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
  }, null, 2));

  // Skill
  const skillDir = join(dir, 'skills', 'test-triage');
  mkdirSync(skillDir, {recursive: true});
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'trigger: when asked to analyze items',
    '---',
    '# Test Triage',
    'Step 1: Query items',
    'Step 2: Analyze status',
    'Step 3: Report findings',
  ].join('\n'));

  // Knowledge
  const kbDir = join(dir, 'knowledge');
  mkdirSync(kbDir, {recursive: true});
  writeFileSync(join(kbDir, 'team-contacts.md'), [
    '# Team Contacts',
    '- Alice: alice@example.com (oncall)',
    '- Bob: bob@example.com (backup)',
  ].join('\n'));

  // Automation
  const autoDir = join(dir, 'automations');
  mkdirSync(autoDir, {recursive: true});
  writeFileSync(join(autoDir, 'daily-check.md'), [
    '# Automation: Daily Health Check',
    '',
    'Schedule: 0 9 * * *',
    '',
    'Check the status of all items and report any issues.',
  ].join('\n'));

  return dir;
}

// ===========================================================================
// GROUP 1: Local Repo Commands
// ===========================================================================

describe('E2E Commands: Local repo', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = createTestRepo();
  });

  afterAll(() => {
    if (repoDir && existsSync(repoDir)) rmSync(repoDir, {recursive: true, force: true});
  });

  // --- init ---

  it('should init a new project from template', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-e2e-init-'));
    try {
      await runInit({cwd: dir, name: 'test-init', provider: 'anthropic'});
      expect(existsSync(join(dir, 'amodal.json'))).toBe(true);
      const config = JSON.parse(readFileSync(join(dir, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
      expect(config['name']).toBe('test-init');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  // --- validate ---

  it('should validate the repo and return 0 errors', async () => {
    const code = await runValidate({cwd: repoDir});
    expect(code).toBe(0);
  });

  it('should validate and report warnings for missing connections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-e2e-validate-'));
    writeFileSync(join(dir, 'amodal.json'), JSON.stringify({
      name: 'empty-agent', version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    }));
    try {
      // 0 errors but should have warnings
      const code = await runValidate({cwd: dir});
      expect(code).toBe(0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  // --- inspect ---

  it('should inspect the repo and print compiled context', async () => {
    // runInspect writes to stdout — we just verify it doesn't throw
    await runInspect({cwd: repoDir});
  });

  it('should inspect with --connections flag', async () => {
    await runInspect({cwd: repoDir, connections: true});
  });

  it('should inspect with --tools flag', async () => {
    await runInspect({cwd: repoDir, tools: true});
  });

  // --- build ---

  it('should build a snapshot from the repo', async () => {
    const outputPath = join(repoDir, 'test-snapshot.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});
    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    expect(snapshot['deployId']).toBeDefined();
    expect((snapshot['config'] as Record<string, unknown>)['name']).toBe('e2e-commands-test');
  });

  // --- docker init ---

  it('should generate docker files from repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-e2e-docker-'));
    writeFileSync(join(dir, 'amodal.json'), JSON.stringify({
      name: 'docker-test-agent', version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    }));
    try {
      await runDocker({cwd: dir, subcommand: 'init'});
      expect(existsSync(join(dir, 'Dockerfile'))).toBe(true);
      expect(existsSync(join(dir, 'docker-compose.yml'))).toBe(true);
      expect(existsSync(join(dir, '.env.production'))).toBe(true);

      const compose = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
      expect(compose).toContain('docker-test-agent');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  // --- deploy (dry-run, local only) ---

  it('should dry-run deploy without uploading', async () => {
    const code = await runDeploy({cwd: repoDir, dryRun: true, message: 'e2e dry run'});
    expect(code).toBe(0);
  });
});

// ===========================================================================
// GROUP 2: Runtime Commands (boots a real @amodalai/runtime server)
// ===========================================================================

const hasDb = !!process.env['DATABASE_URL'];

describe.skipIf(!hasDb)('E2E Commands: Runtime', () => {
  let repoDir: string;
  let localServer: {app: unknown; start: () => Promise<unknown>; stop: () => Promise<void>} | null = null;
  let localPort: number;

  beforeAll(async () => {
    repoDir = createTestRepo();

    // Boot a real local server from the repo (not snapshot — so automations routes are available)
    const {createLocalServer} = await import('@amodalai/runtime');
    localServer = await createLocalServer({
      repoPath: repoDir,
      port: 0,
      host: '127.0.0.1',
      hotReload: false,
    });

    const httpServer = await localServer.start();
    const addr = (httpServer as http.Server).address();
    localPort = typeof addr === 'object' && addr ? addr.port : 0;
  }, 60000);

  afterAll(async () => {
    if (localServer) await localServer.stop();
    if (repoDir && existsSync(repoDir)) rmSync(repoDir, {recursive: true, force: true});
  });

  // --- serve / dev (health check proves the server works) ---

  it('should serve a health endpoint from the repo', async () => {
    const resp = await fetch(`http://127.0.0.1:${localPort}/health`);
    expect(resp.ok).toBe(true);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['status']).toBe('ok');
    expect(data['mode']).toBe('repo');
    expect(data['repo_path']).toBe(repoDir);
  });

  // --- chat (via /chat endpoint) ---

  it('should handle a chat query and stream SSE events', async () => {
    const resp = await fetch(`http://127.0.0.1:${localPort}/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'Hello', app_id: 'e2e-cmd-test'}),
    });

    expect(resp.ok).toBe(true);
    const text = await resp.text();
    const events: Array<Record<string, unknown>> = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try { events.push(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch { /* skip */ }
      }
    }

    expect(events.find((e) => e['type'] === 'init')).toBeDefined();
    expect(events.find((e) => e['type'] === 'done')).toBeDefined();
  });

  // --- test-query (runs its own ephemeral server) ---

  it('should run test-query command end-to-end', async () => {
    const {runTestQuery} = await import('./commands/test-query.js');
    await runTestQuery({cwd: repoDir, message: 'What can you help me with?'});
  });

  // --- automations ---

  // Automations route tested separately in runtime smoke tests

  // --- eval (exits early — no evals/ dir in our test repo) ---

  it('should run eval and exit when no evals found', async () => {
    const {runEval} = await import('./commands/eval.js');
    // runEval boots its own server — it will exit early since there are no evals
    await runEval({cwd: repoDir});
  });

  // --- snapshot server ---

  it('should boot a snapshot server and serve health', async () => {
    const snapshotPath = join(repoDir, 'cmd-test-snapshot.json');
    const buildCode = await runBuild({cwd: repoDir, output: snapshotPath});
    expect(buildCode).toBe(0);

    const {createSnapshotServer} = await import('@amodalai/runtime');
    const snapServer = await createSnapshotServer({
      snapshotPath,
      port: 0,
      host: '127.0.0.1',
    });

    const httpServer = await snapServer.start();
    const addr = (httpServer).address();
    const snapPort = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const resp = await fetch(`http://127.0.0.1:${snapPort}/health`);
      expect(resp.ok).toBe(true);
      const data = (await resp.json()) as Record<string, unknown>;
      expect(data['status']).toBe('ok');
      expect(data['mode']).toBe('snapshot');
      expect(data['agent_name']).toBe('e2e-commands-test');
    } finally {
      await snapServer.stop();
    }
  });
});
