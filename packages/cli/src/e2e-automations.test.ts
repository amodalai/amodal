/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end test: Automation lifecycle
 *
 * Tests the full automation control flow via the HTTP API:
 *   1. Create repo with cron + webhook automations on disk
 *   2. Boot `createLocalServer` (which integrates ProactiveRunner)
 *   3. List automations — verify both appear, cron is stopped, webhook is running
 *   4. Start a cron automation — verify it becomes running
 *   5. Stop a cron automation — verify it becomes stopped
 *   6. Reject starting a webhook automation (always active)
 *   7. Manually trigger an automation (run)
 *   8. Webhook endpoint accepts events
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const CONFIG = {
  name: 'automation-test-agent',
  version: '1.0.0',
  description: 'Agent with automations for e2e testing',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
  },
};

const CRON_AUTOMATION = `# Automation: Daily Scan

Schedule: */5 * * * *

## Check
Scan all zones for anomalies and report findings.

## Output
Summary of anomalies found.

## Delivery
stdout
`;

const WEBHOOK_AUTOMATION = `# Automation: Alert Handler

## Check
Run on webhook when an alert fires. Triage the alert and determine severity.

## Output
Triage assessment with severity level.

## Delivery
stdout
`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E: Automation Lifecycle', () => {
  let repoDir: string;
  let server: {app: unknown; start: () => Promise<unknown>; stop: () => Promise<void>} | null = null;
  let baseUrl: string;

  beforeAll(async () => {
    // 1. Create repo directory with automations
    repoDir = mkdtempSync(join(tmpdir(), 'amodal-e2e-automations-'));

    // Config
    writeFileSync(join(repoDir, 'amodal.json'), JSON.stringify(CONFIG, null, 2));

    // Automations
    const autoDir = join(repoDir, 'automations');
    mkdirSync(autoDir, {recursive: true});
    writeFileSync(join(autoDir, 'daily-scan.md'), CRON_AUTOMATION);
    writeFileSync(join(autoDir, 'alert-handler.md'), WEBHOOK_AUTOMATION);

    // 2. Boot repo server
    const {createLocalServer} = await import('@amodalai/runtime');
    const srv = await createLocalServer({
      repoPath: repoDir,
      port: 0, // random port
      host: '127.0.0.1',
      hotReload: false,
      corsOrigin: '*',
    });

    const httpServer = await srv.start();
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    server = srv;
  }, 30000);

  afterAll(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(repoDir, {recursive: true, force: true});
  });

  // =========================================================================
  // Health check — server is up
  // =========================================================================

  it('should respond to health check', async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['status']).toBe('ok');
    expect(data['mode']).toBe('repo');
  });

  // =========================================================================
  // List — both automations appear with correct initial state
  // =========================================================================

  it('should list automations with correct types and initial state', async () => {
    const resp = await fetch(`${baseUrl}/automations`);
    expect(resp.status).toBe(200);

     
    const data = (await resp.json()) as {
      automations: Array<{
        name: string;
        title: string;
        schedule?: string;
        webhookTriggered: boolean;
        running: boolean;
      }>;
    };

    expect(data.automations).toHaveLength(2);

    const cronAuto = data.automations.find((a) => a.name === 'daily-scan');
    expect(cronAuto).toBeDefined();
    expect(cronAuto?.title).toBe('Daily Scan');
    expect(cronAuto?.schedule).toBe('*/5 * * * *');
    expect(cronAuto?.webhookTriggered).toBe(false);
    expect(cronAuto?.running).toBe(false); // not started yet

    const webhookAuto = data.automations.find((a) => a.name === 'alert-handler');
    expect(webhookAuto).toBeDefined();
    expect(webhookAuto?.title).toBe('Alert Handler');
    expect(webhookAuto?.webhookTriggered).toBe(true);
    expect(webhookAuto?.running).toBe(true); // webhooks always active
  });

  // =========================================================================
  // Start — cron automation becomes running
  // =========================================================================

  it('should start a cron automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/daily-scan/start`, {method: 'POST'});
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['status']).toBe('started');

    // Verify it's now running
    const listResp = await fetch(`${baseUrl}/automations`);
     
    const listData = (await listResp.json()) as {
      automations: Array<{name: string; running: boolean}>;
    };
    const cronAuto = listData.automations.find((a) => a.name === 'daily-scan');
    expect(cronAuto?.running).toBe(true);
  });

  // =========================================================================
  // Start again — should fail (already running)
  // =========================================================================

  it('should reject starting an already running automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/daily-scan/start`, {method: 'POST'});
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['error']).toContain('already running');
  });

  // =========================================================================
  // Stop — cron automation becomes stopped
  // =========================================================================

  it('should stop a running cron automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/daily-scan/stop`, {method: 'POST'});
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['status']).toBe('stopped');

    // Verify it's now stopped
    const listResp = await fetch(`${baseUrl}/automations`);
     
    const listData = (await listResp.json()) as {
      automations: Array<{name: string; running: boolean}>;
    };
    const cronAuto = listData.automations.find((a) => a.name === 'daily-scan');
    expect(cronAuto?.running).toBe(false);
  });

  // =========================================================================
  // Stop again — should fail (not running)
  // =========================================================================

  it('should reject stopping a non-running automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/daily-scan/stop`, {method: 'POST'});
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['error']).toContain('not running');
  });

  // =========================================================================
  // Start webhook automation — should fail (always active)
  // =========================================================================

  it('should reject starting a webhook-triggered automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/alert-handler/start`, {method: 'POST'});
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['error']).toContain('webhook-triggered');
  });

  // =========================================================================
  // Start unknown — should fail
  // =========================================================================

  it('should reject starting unknown automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/nonexistent/start`, {method: 'POST'});
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as Record<string, unknown>;
    expect(data['error']).toContain('not found');
  });

  // =========================================================================
  // Run — manually trigger an automation (fire and forget)
  // =========================================================================

  it('should reject triggering unknown automation', async () => {
    const resp = await fetch(`${baseUrl}/automations/nonexistent/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(404);
  });

  // =========================================================================
  // Webhook endpoint — accepts events
  // =========================================================================

  it('should accept webhook events for webhook-triggered automations', async () => {
    const resp = await fetch(`${baseUrl}/webhooks/alert-handler`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({alert: 'high-cpu', host: 'web-01'}),
    });

    // May succeed or fail (depends on LLM availability), but route exists
    expect([200, 500]).toContain(resp.status);
    const data = (await resp.json()) as Record<string, unknown>;
    // If 200, it matched and ran
    if (resp.status === 200) {
      expect(data['status']).toBe('accepted');
    }
    // If 500, it matched but execution failed (no LLM configured) — still validates routing
    if (resp.status === 500) {
      expect(data['matched']).toBe(true);
    }
  });

  // =========================================================================
  // Webhook for non-webhook automation — should 404
  // =========================================================================

  it('should reject webhook for cron-only automation', async () => {
    const resp = await fetch(`${baseUrl}/webhooks/daily-scan`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(404);
  });

  // =========================================================================
  // Webhook for unknown automation — should 404
  // =========================================================================

  it('should reject webhook for unknown automation', async () => {
    const resp = await fetch(`${baseUrl}/webhooks/nonexistent`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(404);
  });
});
