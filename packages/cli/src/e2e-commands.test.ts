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
import {join, resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import type http from 'node:http';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {runInit} from './commands/init.js';
import {runValidate} from './commands/validate.js';
import {runInspect} from './commands/inspect.js';
import {runBuild} from './commands/build.js';
import {runDeploy} from './commands/deploy.js';
import {runList} from './commands/list.js';
import {runDocker} from './commands/docker.js';
import {runStatus} from './commands/status.js';
import {runDeployments} from './commands/deployments.js';
import {runRollback} from './commands/rollback.js';
import {runPromote} from './commands/promote.js';
import {runExperimentCommand} from './commands/experiment.js';

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

  // Connection
  const connDir = join(dir, 'connections', 'test-api');
  mkdirSync(connDir, {recursive: true});
  writeFileSync(join(connDir, 'spec.json'), JSON.stringify({
    source: 'https://api.example.com/openapi.json',
    format: 'openapi',
    auth: {type: 'bearer', header: 'Authorization', prefix: 'Bearer', token: 'env:TEST_API_TOKEN'},
  }, null, 2));
  writeFileSync(join(connDir, 'access.json'), JSON.stringify({
    endpoints: {
      'GET /items': {returns: ['id', 'name', 'status']},
      'GET /items/:id': {returns: ['id', 'name', 'status', 'details']},
    },
  }, null, 2));
  writeFileSync(join(connDir, 'surface.md'), [
    '## Included',
    '- [x] GET /items — List all items',
    '- [x] GET /items/:id — Get item by ID',
    '## Excluded',
    '- [ ] POST /items — Create new item (write)',
  ].join('\n'));

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
    '---',
    'title: Daily Health Check',
    'schedule: "0 9 * * *"',
    'output:',
    '  channel: slack',
    '  target: "#ops"',
    '---',
    'Check the status of all items and report any issues.',
  ].join('\n'));

  return dir;
}

// ---------------------------------------------------------------------------
// Shared: Start the real @amodalai/platform-api (Next.js) server
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In vitest forks, __dirname is the source dir (packages/cli/src).
// Go up to packages/ then into platform-api/.
const PLATFORM_API_DIR = resolve(__dirname, '../../platform-api');

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function startPlatformApi(port: number): ChildProcess {
  // Run next dev via node directly — avoids PATH/shell issues in vitest forks
  const nextCli = resolve(PLATFORM_API_DIR, 'node_modules/next/dist/bin/next');
  const child = spawn(process.execPath, [nextCli, 'dev', '--port', String(port)], {
    cwd: PLATFORM_API_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      // No DATABASE_URL → uses PGlite in-memory (zero external deps)
      DATABASE_URL: '',
      NODE_ENV: 'development',
    },
  });
  return child;
}

interface OnboardingResult {
  org: {id: string};
  app: {id: string};
  tenant: {id: string};
  api_key: {id: string; key: string};
}

async function onboard(baseUrl: string): Promise<OnboardingResult> {
  const resp = await fetch(`${baseUrl}/api/onboarding`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      app_name: 'e2e-commands-test',
      agent_context: 'E2E test agent for CLI command testing',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Onboarding failed (${resp.status}): ${text}`);
  }
   
  return resp.json() as Promise<OnboardingResult>;
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

  // --- list ---

  it('should list packages (empty lock file)', async () => {
    const code = await runList({cwd: repoDir});
    // No lock file = returns 0 with "no packages" message
    expect(code).toBe(0);
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
// GROUP 2: Platform API Commands (real @amodalai/platform-api server)
// ===========================================================================

describe('E2E Commands: Platform API', () => {
  let platformProc: ChildProcess;
  let platformPort: number;
  let apiKey: string;
  let origUrl: string | undefined;
  let origKey: string | undefined;
  let origHome: string | undefined;

  beforeAll(async () => {
    // Pick a random port in the ephemeral range
    platformPort = 14000 + Math.floor(Math.random() * 1000);
    const baseUrl = `http://127.0.0.1:${platformPort}`;

    // Start the real platform-api (Next.js dev server with PGlite in-memory)
    platformProc = startPlatformApi(platformPort);
    await waitForServer(`${baseUrl}/api/health`, 60000);

    // Onboard to create org + app + tenant + API key
    const result = await onboard(baseUrl);
    apiKey = result.api_key.key;

    // Deploy two snapshots so status/deployments/rollback/promote have data
    const repoDir = createTestRepo();
    try {
      // First deploy to production
      const snap1 = join(repoDir, 'snap1.json');
      await runBuild({cwd: repoDir, output: snap1});
      const snap1Data = JSON.parse(readFileSync(snap1, 'utf-8')) as Record<string, unknown>;
      await fetch(`${baseUrl}/api/snapshot-deployments`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`},
        body: JSON.stringify({snapshot: snap1Data, environment: 'production'}),
      });

      // Second deploy to staging
      const snap2 = join(repoDir, 'snap2.json');
      await runBuild({cwd: repoDir, output: snap2});
      const snap2Data = JSON.parse(readFileSync(snap2, 'utf-8')) as Record<string, unknown>;
      await fetch(`${baseUrl}/api/snapshot-deployments`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`},
        body: JSON.stringify({snapshot: snap2Data, environment: 'staging'}),
      });

      // Third deploy to production (so rollback has a previous version)
      const snap3 = join(repoDir, 'snap3.json');
      await runBuild({cwd: repoDir, output: snap3});
      const snap3Data = JSON.parse(readFileSync(snap3, 'utf-8')) as Record<string, unknown>;
      await fetch(`${baseUrl}/api/snapshot-deployments`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`},
        body: JSON.stringify({snapshot: snap3Data, environment: 'production'}),
      });
    } finally {
      rmSync(repoDir, {recursive: true, force: true});
    }

    // Set env vars so PlatformClient and resolvePlatformConfig use the real server
    origUrl = process.env['PLATFORM_API_URL'];
    origKey = process.env['PLATFORM_API_KEY'];
    origHome = process.env['HOME'];
    process.env['PLATFORM_API_URL'] = baseUrl;
    process.env['PLATFORM_API_KEY'] = apiKey;
    // Isolate from real ~/.amodalrc
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'amodal-e2e-home-'));
  }, 120000);

  afterAll(async () => {
    if (origUrl !== undefined) process.env['PLATFORM_API_URL'] = origUrl;
    else delete process.env['PLATFORM_API_URL'];
    if (origKey !== undefined) process.env['PLATFORM_API_KEY'] = origKey;
    else delete process.env['PLATFORM_API_KEY'];
    if (origHome !== undefined) process.env['HOME'] = origHome;
    else delete process.env['HOME'];

    if (platformProc) {
      platformProc.kill('SIGTERM');
      // Give it a moment to shut down gracefully
      await new Promise((r) => setTimeout(r, 1000));
      if (!platformProc.killed) platformProc.kill('SIGKILL');
    }
  });

  // --- status ---

  it('should show deployment status', async () => {
    const code = await runStatus({});
    expect(code).toBe(0);
  });

  it('should show status for specific environment', async () => {
    const code = await runStatus({env: 'staging'});
    expect(code).toBe(0);
  });

  it('should show status as JSON', async () => {
    const code = await runStatus({json: true});
    expect(code).toBe(0);
  });

  // --- deployments ---

  it('should list deployments', async () => {
    const code = await runDeployments({});
    expect(code).toBe(0);
  });

  it('should list deployments filtered by env', async () => {
    const code = await runDeployments({env: 'production'});
    expect(code).toBe(0);
  });

  it('should list deployments as JSON', async () => {
    const code = await runDeployments({json: true});
    expect(code).toBe(0);
  });

  it('should list deployments with limit', async () => {
    const code = await runDeployments({limit: 1});
    expect(code).toBe(0);
  });

  // --- rollback ---

  it('should rollback production deployment', async () => {
    const code = await runRollback({env: 'production'});
    expect(code).toBe(0);
  });

  // --- promote ---

  it('should promote staging to production', async () => {
    const code = await runPromote({fromEnv: 'staging', toEnv: 'production'});
    expect(code).toBe(0);
  });

  // --- experiment ---

  it('should list experiments', async () => {
    await runExperimentCommand({
      action: 'list',
      platformUrl: `http://127.0.0.1:${platformPort}`,
      platformApiKey: apiKey,
    });
  });

  it('should create an experiment', async () => {
    await runExperimentCommand({
      action: 'create',
      name: 'new-experiment',
      platformUrl: `http://127.0.0.1:${platformPort}`,
      platformApiKey: apiKey,
    });
  });

  // --- deploy (real upload to real platform) ---

  it('should deploy snapshot to platform', async () => {
    const repoDir = createTestRepo();
    try {
      const code = await runDeploy({cwd: repoDir, message: 'e2e platform deploy', env: 'staging'});
      expect(code).toBe(0);
    } finally {
      rmSync(repoDir, {recursive: true, force: true});
    }
  });
});

// ===========================================================================
// GROUP 3: Runtime Commands (boots a real @amodalai/runtime server)
// ===========================================================================

describe('E2E Commands: Runtime', () => {
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
      body: JSON.stringify({message: 'Hello', tenant_id: 'e2e-cmd-test'}),
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

  it('should list automations on the running server', async () => {
    const {runAutomationsList} = await import('./commands/automations.js');
    const code = await runAutomationsList({url: `http://127.0.0.1:${localPort}`});
    expect(code).toBe(0);
  });

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
