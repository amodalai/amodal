/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const HAS_DATABASE_URL = DATABASE_URL.length > 0;
const RUNTIME_URL = process.env['RUNTIME_URL'] ?? 'http://localhost:3000';
const REPO_PATH = process.env['REPO_PATH'] ?? '/tmp/amodal-smoke-test-repo';
const CORS_ORIGIN = 'http://localhost:3847';
const STUDIO_DIR = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.resolve(STUDIO_DIR, 'dist');
const HAS_DIST = existsSync(path.join(DIST_DIR, 'index.html'));

class SmokeServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmokeServerError';
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let baseUrl = '';

function startServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const port = 10_000 + Math.floor(Math.random() * 50_000);
    const child = spawn('npx', ['tsx', 'src/server/studio-server.ts'], {
      cwd: STUDIO_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL,
        RUNTIME_URL,
        REPO_PATH,
        STUDIO_CORS_ORIGINS: CORS_ORIGIN,
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess = child;
    let started = false;

    const timeout = setTimeout(() => {
      if (!started) {
        child.kill('SIGTERM');
        reject(new SmokeServerError('Server did not start within 20 seconds'));
      }
    }, 20_000);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      if (!started && text.includes('studio_server_started')) {
        started = true;
        clearTimeout(timeout);
        resolve(`http://localhost:${port}`);
      }
    };

    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);

    child.on('error', (err) => {
      if (!started) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new SmokeServerError(`Server exited with code ${String(code)} before starting`));
      }
    });
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_DATABASE_URL)('Studio server smoke tests', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    baseUrl = await startServer();
  });

  afterAll(() => {
    stopServer();
  });

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  test('GET /api/config returns agent config', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('agentName');
    expect(body).toHaveProperty('runtimeUrl');
    expect(body).toHaveProperty('agentId');
    expect(body).toHaveProperty('registryUrl');
  });

  // -------------------------------------------------------------------------
  // SPA serving (requires dist/ to exist)
  // -------------------------------------------------------------------------

  test.skipIf(!HAS_DIST)('GET / serves SPA index.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<div id="app">');
  });

  test.skipIf(!HAS_DIST)('GET /stores serves SPA (client-side routing)', async () => {
    const res = await fetch(`${baseUrl}/stores`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<div id="app">');
  });

  // -------------------------------------------------------------------------
  // Store list
  // -------------------------------------------------------------------------

  test('GET /api/stores returns store list', async () => {
    const res = await fetch(`${baseUrl}/api/stores`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('stores');
    expect(Array.isArray(body['stores'])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // SSE events
  // -------------------------------------------------------------------------

  test('GET /api/events streams SSE', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // We got the headers, that's enough to confirm SSE is wired up.
    controller.abort();
  });

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  test('GET /api/drafts returns draft list', async () => {
    const res = await fetch(`${baseUrl}/api/drafts`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('drafts');
    expect(Array.isArray(body['drafts'])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  test('POST /api/preview returns validation error when no drafts exist', async () => {
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    const error = body['error'] as Record<string, unknown>;
    expect(error['code']).toBe('NO_DRAFTS');
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------

  test('CORS preflight returns 204 for allowed origin', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'OPTIONS',
      headers: {
        Origin: CORS_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(CORS_ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  test('CORS omits allow-origin header for disallowed origin', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example.com',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Config response shape
  // -------------------------------------------------------------------------

  test('GET /api/config returns agentId from env', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const body = (await res.json()) as Record<string, unknown>;
    // AGENT_ID is set in the test server env
    expect(typeof body['agentId']).toBe('string');
    expect(typeof body['agentName']).toBe('string');
    expect(typeof body['runtimeUrl']).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Automations
  // -------------------------------------------------------------------------

  test('GET /api/automations returns wrapped object', async () => {
    const res = await fetch(`${baseUrl}/api/automations`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('automations');
    expect(Array.isArray(body['automations'])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Evals
  // -------------------------------------------------------------------------

  test('GET /api/evals/arena/models returns wrapped models', async () => {
    const res = await fetch(`${baseUrl}/api/evals/arena/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('models');
    expect(Array.isArray(body['models'])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  test('GET /api/feedback returns wrapped entries', async () => {
    const res = await fetch(`${baseUrl}/api/feedback?agentId=test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body['entries'])).toBe(true);
  });

  test('GET /api/feedback/summary returns wrapped summary', async () => {
    const res = await fetch(`${baseUrl}/api/feedback/summary?agentId=test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('summary');
  });

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  test('GET /api/workspace returns workspace bundle', async () => {
    const res = await fetch(`${baseUrl}/api/workspace`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('agentId');
    expect(body).toHaveProperty('files');
  });

  // -------------------------------------------------------------------------
  // Discard
  // -------------------------------------------------------------------------

  test('POST /api/discard returns discarded count', async () => {
    const res = await fetch(`${baseUrl}/api/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('discarded');
  });

  // -------------------------------------------------------------------------
  // 404 for unknown API routes
  // -------------------------------------------------------------------------

  test('GET /api/nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });
});
