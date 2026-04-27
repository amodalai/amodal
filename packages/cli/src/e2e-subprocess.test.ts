/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Subprocess smoke tests — verify that `amodal dev` spawns all three
 * processes (runtime, studio, admin agent) and they respond to health
 * checks.
 *
 * Requires DATABASE_URL and at least one provider API key.
 * Skips cleanly when prerequisites are missing.
 *
 * Run:
 *   pnpm --filter @amodalai/amodal vitest run src/e2e-subprocess.test.ts
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {spawn, type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');

function loadTestEnv(): void {
  try {
    const envPath = resolve(__dir, '../../../.env.test');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value.trim();
        }
      }
    }
  } catch { /* no .env.test */ }
}

loadTestEnv();

const RUNTIME_PORT = 19847;
const STUDIO_PORT = 3848;
const ADMIN_PORT = 3849;

const hasApiKey = !!(
  process.env['GOOGLE_API_KEY'] ||
  process.env['ANTHROPIC_API_KEY'] ||
  process.env['OPENAI_API_KEY']
);
const hasDb = !!process.env['DATABASE_URL'];
const skipReason = !hasApiKey
  ? 'No provider API key configured'
  : !hasDb
    ? 'DATABASE_URL not set'
    : '';

async function waitForHealth(port: number, maxMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {signal: AbortSignal.timeout(1000)});
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

describe.skipIf(!!skipReason)('subprocess smoke tests', () => {
  let child: ChildProcess | null = null;
  let agentDir: string;

  beforeAll(async () => {
    agentDir = mkdtempSync(resolve(tmpdir(), 'amodal-subprocess-smoke-'));
    writeFileSync(
      resolve(agentDir, 'amodal.json'),
      JSON.stringify({name: 'subprocess-smoke', version: '1.0.0'}),
    );

    // Create a test knowledge file for file tools tests
    const knowledgeDir = resolve(agentDir, 'knowledge');
    mkdirSync(knowledgeDir, {recursive: true});
    writeFileSync(resolve(knowledgeDir, 'test-doc.md'), '# Test\n\nSENTINEL_FILE_TOOLS_9923\n');

    // Create a test eval for eval/arena tests
    const evalsDir = resolve(agentDir, 'evals');
    mkdirSync(evalsDir, {recursive: true});
    writeFileSync(resolve(evalsDir, 'math-check.md'), [
      '# Eval: Math Check',
      '',
      '## Query',
      'What is 2 + 2? Reply with just the number.',
      '',
      '## Assertions',
      '- Should contain the number 4',
    ].join('\n'));

    const cliEntry = resolve(__dir, '../dist/src/main.js');
    if (!existsSync(cliEntry)) {
      throw new Error(`CLI not built — run pnpm --filter @amodalai/amodal run build first`);
    }

    child = spawn(
      process.execPath,
      [cliEntry, 'dev', '--port', String(RUNTIME_PORT)],
      {
        cwd: agentDir,
        env: {
          ...process.env,
          AMODAL_NO_ADMIN: undefined,
          AMODAL_NO_STUDIO: undefined,
        },
        stdio: 'pipe',
      },
    );

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[subprocess-smoke] ${chunk.toString()}`);
    });

    const runtimeOk = await waitForHealth(RUNTIME_PORT, 90_000);
    if (!runtimeOk) {
      throw new Error('Runtime did not start within 90s');
    }
  }, 120_000);

  afterAll(() => {
    if (child) {
      child.kill('SIGTERM');
      child = null;
    }
    if (agentDir) {
      rmSync(agentDir, {recursive: true, force: true});
    }
  });

  it('runtime responds to health check', async () => {
    const res = await fetch(`http://localhost:${RUNTIME_PORT}/health`, {signal: AbortSignal.timeout(5000)});
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['status']).toBe('ok');
  });

  it('auth/token returns 404 in local dev (no auth system)', async () => {
    const res = await fetch(`http://localhost:${RUNTIME_PORT}/auth/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(404);
  });

  it('studio responds to health check', async () => {
    const ok = await waitForHealth(STUDIO_PORT, 15_000);
    expect(ok).toBe(true);
  }, 20_000);

  it('admin agent responds to health check', async () => {
    const ok = await waitForHealth(ADMIN_PORT, 15_000);
    expect(ok).toBe(true);
  }, 20_000);

  it('admin agent accepts a chat request', async () => {
    const res = await fetch(`http://localhost:${ADMIN_PORT}/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'Say hello in one word'}),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('data:');
  }, 45_000);

  it('studio proxies admin chat to admin agent', async () => {
    const res = await fetch(`http://localhost:${STUDIO_PORT}/api/studio/admin-chat/stream`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'Say ok'}),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data:');
  }, 45_000);

  it('admin agent reads a file from the repo using file tools', async () => {
    const res = await fetch(`http://localhost:${ADMIN_PORT}/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'Read the file knowledge/test-doc.md using the read_repo_file tool and tell me its contents.'}),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('tool_call_start');
    expect(text).toContain('SENTINEL_FILE_TOOLS_9923');
  }, 45_000);

  it('runtime runs eval and returns SSE results', async () => {
    const res = await fetch(`http://localhost:${RUNTIME_PORT}/api/evals/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({evalNames: ['math-check']}),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('eval_complete');
  }, 45_000);

  it('runtime runs arena eval with specified model', async () => {
    const res = await fetch(`http://localhost:${RUNTIME_PORT}/api/evals/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        evalNames: ['math-check'],
        model: {provider: 'google', model: 'gemini-2.0-flash'},
      }),
      signal: AbortSignal.timeout(30_000),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('eval_complete');
  }, 45_000);
});
