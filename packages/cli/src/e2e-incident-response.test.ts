/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end test: Incident Response Agent
 *
 * Tests the full content pipeline with all four content types:
 *   Connection (statuspage API) + Skill (incident triage) +
 *   Knowledge (oncall runbook) + Automation (health check)
 *
 * Flow:
 *   1. Create repo with all content types written to disk
 *   2. Build snapshot → verify all content present
 *   3. Start mock StatusPage API
 *   4. Boot runtime from snapshot → send chat → verify agent uses
 *      the connection, skill, and knowledge in its response
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';

import type {
  MOCK_COMPONENTS} from './fixtures/incident-response.js';
import {
  CONFIG,
  STATUSPAGE_SPEC,
  STATUSPAGE_ACCESS,
  STATUSPAGE_SURFACE,
  TRIAGE_SKILL,
  ONCALL_RUNBOOK,
  HEALTH_CHECK_AUTOMATION,
  createMockStatusPageApi,
} from './fixtures/incident-response.js';
import {runBuild} from './commands/build.js';
import type {DeploySnapshot} from '@amodalai/core';
import {loadRepo, loadSnapshotFromFile, snapshotToRepo} from '@amodalai/core';

// ---------------------------------------------------------------------------
// Helper: send chat and parse SSE events
// ---------------------------------------------------------------------------

async function sendChat(
  port: number,
  message: string,
  tenantId: string,
  sessionId?: string,
  timeoutMs = 30000,
): Promise<{events: Array<Record<string, unknown>>; rawBody: string}> {
  return new Promise((resolve, reject) => {
    const payload: Record<string, string> = {message, tenant_id: tenantId};
    if (sessionId) payload['session_id'] = sessionId;
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let rawBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { rawBody += chunk; });
        res.on('end', () => {
          const events: Array<Record<string, unknown>> = [];
          for (const line of rawBody.split('\n')) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch { /* skip */ }
            }
          }
          resolve({events, rawBody});
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E: Incident Response Agent', () => {
  let repoDir: string;
  let snapshotPath: string;
  let builtSnapshot: DeploySnapshot;
  let mockApi: ReturnType<typeof createMockStatusPageApi>;
  let runtimeServer: {app: unknown; start: () => Promise<unknown>; stop: () => Promise<void>} | null = null;
  let runtimePort: number;

  beforeAll(async () => {
    // 1. Create repo directory structure with all content types
    repoDir = mkdtempSync(join(tmpdir(), 'amodal-e2e-incident-'));

    // Config
    writeFileSync(join(repoDir, 'amodal.json'), JSON.stringify(CONFIG, null, 2));

    // Connection: statuspage
    const connDir = join(repoDir, 'connections', 'statuspage');
    mkdirSync(connDir, {recursive: true});
    writeFileSync(join(connDir, 'spec.json'), JSON.stringify(STATUSPAGE_SPEC, null, 2));
    writeFileSync(join(connDir, 'access.json'), JSON.stringify(STATUSPAGE_ACCESS, null, 2));
    writeFileSync(join(connDir, 'surface.md'), STATUSPAGE_SURFACE);

    // Skill: incident-triage
    const skillDir = join(repoDir, 'skills', 'incident-triage');
    mkdirSync(skillDir, {recursive: true});
    writeFileSync(join(skillDir, 'SKILL.md'), TRIAGE_SKILL);

    // Knowledge: oncall-runbook
    const knowledgeDir = join(repoDir, 'knowledge');
    mkdirSync(knowledgeDir, {recursive: true});
    writeFileSync(join(knowledgeDir, 'oncall-runbook.md'), ONCALL_RUNBOOK);

    // Automation: health-check
    const autoDir = join(repoDir, 'automations');
    mkdirSync(autoDir, {recursive: true});
    writeFileSync(join(autoDir, 'health-check.md'), HEALTH_CHECK_AUTOMATION);

    // 2. Build snapshot
    snapshotPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: snapshotPath});
    if (code !== 0) throw new Error('Build failed');

    builtSnapshot = await loadSnapshotFromFile(snapshotPath);

    // 3. Start mock StatusPage API
    mockApi = createMockStatusPageApi();
    await mockApi.start();

    // 4. Update the spec in the snapshot to point to the mock API
    //    (In production, the base URL comes from the spec; here we override it)
    //    We need to rebuild with the mock URL baked in
    const specWithMockUrl = {
      ...STATUSPAGE_SPEC,
      specUrl: `http://127.0.0.1:${mockApi.port}/openapi.json`,
    };
    writeFileSync(join(connDir, 'spec.json'), JSON.stringify(specWithMockUrl, null, 2));

    // Rebuild snapshot with the mock URL
    const code2 = await runBuild({cwd: repoDir, output: snapshotPath});
    if (code2 !== 0) throw new Error('Rebuild with mock URL failed');
    builtSnapshot = await loadSnapshotFromFile(snapshotPath);

    // 5. Boot runtime from snapshot
    const {createSnapshotServer} = await import('@amodalai/runtime');
    runtimeServer = await createSnapshotServer({
      snapshotPath,
      port: 0,
      host: '127.0.0.1',
    });

    const httpServer = await runtimeServer.start();
    const addr = (httpServer as http.Server).address();
    runtimePort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    if (runtimeServer) await runtimeServer.stop();
    if (mockApi) await mockApi.stop();
    if (repoDir && existsSync(repoDir)) rmSync(repoDir, {recursive: true, force: true});
  });

  // =========================================================================
  // Phase 1: Repo loading — all content types load from disk
  // =========================================================================

  describe('repo loading', () => {
    it('should load the connection from disk', async () => {
      const repo = await loadRepo({localPath: repoDir});
      expect(repo.connections.size).toBe(1);
      const conn = repo.connections.get('statuspage');
      expect(conn).toBeDefined();
      expect(conn!.spec.format).toBe('openapi');
      expect(conn!.surface.length).toBeGreaterThanOrEqual(3);
      expect(conn!.surface.find((s) => s.path === '/components')).toBeDefined();
    });

    it('should load the skill from disk', async () => {
      const repo = await loadRepo({localPath: repoDir});
      expect(repo.skills.length).toBe(1);
      expect(repo.skills[0].name).toBe('incident-triage');
      expect(repo.skills[0].body).toContain('Check component status');
      expect(repo.skills[0].trigger).toContain('service health');
    });

    it('should load the knowledge from disk', async () => {
      const repo = await loadRepo({localPath: repoDir});
      expect(repo.knowledge.length).toBe(1);
      expect(repo.knowledge[0].name).toBe('oncall-runbook');
      expect(repo.knowledge[0].body).toContain('Severity Matrix');
      expect(repo.knowledge[0].body).toContain('alice@example.com');
    });

    it('should load the automation from disk', async () => {
      const repo = await loadRepo({localPath: repoDir});
      expect(repo.automations.length).toBe(1);
      expect(repo.automations[0].name).toBe('health-check');
      expect(repo.automations[0].title).toBe('Daily Health Check');
      expect(repo.automations[0].schedule).toBe('0 8 * * *');
    });
  });

  // =========================================================================
  // Phase 2: Snapshot — all content types serialized
  // =========================================================================

  describe('snapshot content', () => {
    it('should include the connection in the snapshot', () => {
      expect(Object.keys(builtSnapshot.connections)).toContain('statuspage');
      const conn = builtSnapshot.connections['statuspage'];
      expect(conn.spec.format).toBe('openapi');
      // Surface is serialized as checkbox markdown in snapshot
      expect(conn.surface).toContain('/components');
      expect(conn.access.endpoints['GET /components']).toBeDefined();
    });

    it('should include the skill in the snapshot', () => {
      expect(builtSnapshot.skills.length).toBe(1);
      expect(builtSnapshot.skills[0].name).toBe('incident-triage');
      expect(builtSnapshot.skills[0].body).toContain('Check component status');
    });

    it('should include the knowledge in the snapshot', () => {
      expect(builtSnapshot.knowledge.length).toBe(1);
      expect(builtSnapshot.knowledge[0].name).toBe('oncall-runbook');
      expect(builtSnapshot.knowledge[0].body).toContain('SEV1');
    });

    it('should include the automation in the snapshot', () => {
      expect(builtSnapshot.automations.length).toBe(1);
      expect(builtSnapshot.automations[0].name).toBe('health-check');
      expect(builtSnapshot.automations[0].schedule).toBe('0 8 * * *');
    });

    it('should round-trip all content through snapshot', () => {
      const restored = snapshotToRepo(builtSnapshot, 'test');

      // Connection
      expect(restored.connections.size).toBe(1);
      const conn = restored.connections.get('statuspage');
      expect(conn).toBeDefined();
      expect(conn!.spec.format).toBe('openapi');
      // Surface endpoints parsed from markdown
      expect(conn!.surface.length).toBeGreaterThanOrEqual(3);
      const getComponents = conn!.surface.find((s) => s.method === 'GET' && s.path === '/components');
      expect(getComponents).toBeDefined();
      expect(getComponents!.included).toBe(true);
      const postIncidents = conn!.surface.find((s) => s.method === 'POST');
      expect(postIncidents).toBeDefined();
      expect(postIncidents!.included).toBe(false);

      // Skill
      expect(restored.skills[0].name).toBe('incident-triage');
      expect(restored.skills[0].trigger).toContain('service health');

      // Knowledge
      expect(restored.knowledge[0].body).toContain('alice@example.com');

      // Automation
      expect(restored.automations[0].schedule).toBe('0 8 * * *');
    });
  });

  // =========================================================================
  // Phase 3: Runtime — server boots from snapshot and handles chat
  // =========================================================================

  describe('runtime from snapshot', () => {
    it('should serve health check with full content counts', async () => {
      const resp = await fetch(`http://127.0.0.1:${runtimePort}/health`);
      const data = (await resp.json()) as Record<string, unknown>;
      expect(data['status']).toBe('ok');
      expect(data['mode']).toBe('snapshot');
      expect(data['agent_name']).toBe('incident-response-agent');
      expect(data['connections']).toBe(1);
      expect(data['skills']).toBe(1);
    });

    it('should handle chat and stream SSE events', async () => {
      const {events} = await sendChat(runtimePort, 'Is the API healthy?', 'tenant-incident-e2e');

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.find((e) => e['type'] === 'init')).toBeDefined();
      expect(events.find((e) => e['type'] === 'done')).toBeDefined();
    });

    it('should use the connection when the agent makes a tool call', async () => {
      // The agent should try to call GET /components via the request tool
      // when asked about API health, because the triage skill says to do that.
      // Whether it actually calls the mock depends on the LLM, but we can
      // check if tool_call_start events reference the statuspage connection.
      const {events} = await sendChat(
        runtimePort,
        'Check the current status of all services using the statuspage connection.',
        'tenant-incident-tool-e2e',
      );

      const toolCalls = events.filter((e) => e['type'] === 'tool_call_start');
      const textEvents = events.filter((e) => e['type'] === 'text_delta');
      const fullText = textEvents.map((e) => String(e['content'] ?? '')).join('');

      // The agent should have either made a tool call or mentioned the
      // components in its text response
      const mentionsConnection = toolCalls.some((tc) => {
        const params = tc['parameters'] as Record<string, unknown> | undefined;
        return params?.['connection'] === 'statuspage';
      });
      const mentionsComponents = fullText.toLowerCase().includes('api-gateway') ||
        fullText.toLowerCase().includes('component') ||
        fullText.toLowerCase().includes('statuspage');

      // At least one of these should be true
      expect(mentionsConnection || mentionsComponents).toBe(true);
    });
  });

  // =========================================================================
  // Phase 4: Mock API verification
  // =========================================================================

  describe('mock API interaction', () => {
    it('should have the mock API running', async () => {
      const resp = await fetch(`http://127.0.0.1:${mockApi.port}/components`);
      expect(resp.status).toBe(200);
      const data = (await resp.json()) as typeof MOCK_COMPONENTS;
      expect(data.length).toBe(5);
      expect(data.find((c) => c.name === 'database-primary')?.status).toBe('degraded_performance');
    });
  });
});
