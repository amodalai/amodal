/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Fixture data for the incident response e2e test.
 *
 * Four content types:
 * 1. Connection: statuspage API (mock)
 * 2. Skill: incident triage methodology
 * 3. Knowledge: oncall runbook
 * 4. Automation: daily health check
 *
 * The mock API returns deterministic data so we can assert on the
 * agent's response content.
 */

import http from 'node:http';

// ---------------------------------------------------------------------------
// amodal.json
// ---------------------------------------------------------------------------

export const CONFIG = {
  name: 'incident-response-agent',
  version: '1.0.0',
  description: 'Monitors services and triages incidents',
  models: {
    main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
  },
};

// ---------------------------------------------------------------------------
// Connection: statuspage
// ---------------------------------------------------------------------------

export const STATUSPAGE_SPEC = {
  baseUrl: 'https://statuspage.example.com/api/v1',
  specUrl: 'https://statuspage.example.com/api/v1/openapi.json',
  format: 'openapi' as const,
  auth: {
    type: 'bearer',
    header: 'Authorization',
    prefix: 'Bearer',
    token: 'env:STATUSPAGE_TOKEN',
  },
};

export const STATUSPAGE_ACCESS = {
  endpoints: {
    'GET /components': {returns: ['id', 'name', 'status', 'updated_at']},
    'GET /incidents': {returns: ['id', 'name', 'status', 'impact', 'created_at']},
    'GET /incidents/:id': {returns: ['id', 'name', 'status', 'impact', 'body', 'components']},
    'POST /incidents': {returns: ['id'], confirm: 'review' as const},
  },
};

export const STATUSPAGE_SURFACE = `## Included

### GET /components
List all monitored components and their current status

### GET /incidents
List recent incidents

### GET /incidents/:id
Get incident details

## Excluded

### POST /incidents
Create a new incident (requires confirmation)
`;

// ---------------------------------------------------------------------------
// Skill: incident-triage
// ---------------------------------------------------------------------------

export const TRIAGE_SKILL = `---
name: incident-triage
description: Methodology for triaging service incidents based on component status
trigger: When the user asks about service health, incidents, or outages
---

## Incident Triage

Follow this methodology when assessing service health:

1. **Check component status** — Query GET /components to see current state of all services
2. **Identify degraded components** — Any component not in "operational" status needs attention
3. **Assess severity** — Use the severity matrix from the oncall runbook
4. **Check recent incidents** — Query GET /incidents for correlated issues
5. **Recommend action** — Based on severity, recommend the appropriate response from the runbook

Always report the exact component names and their statuses. Never fabricate status data.
`;

// ---------------------------------------------------------------------------
// Knowledge: oncall-runbook
// ---------------------------------------------------------------------------

export const ONCALL_RUNBOOK = `# On-Call Runbook

## Severity Matrix

| Level | Criteria | Response Time | Escalation |
|-------|----------|---------------|------------|
| SEV1 | Multiple components down | 5 min | Page on-call lead immediately |
| SEV2 | Single component degraded | 15 min | Notify #incidents channel |
| SEV3 | Performance degradation | 1 hour | Create ticket |
| SEV4 | Cosmetic or minor | Next business day | Log for review |

## Key Contacts

- **On-call lead**: Alice (alice@example.com)
- **Platform team**: Bob (bob@example.com)
- **Database team**: Charlie (charlie@example.com)

## Components

- **api-gateway**: Main API entry point. SEV1 if down.
- **auth-service**: Authentication. SEV1 if down.
- **database-primary**: Primary Postgres. SEV1 if down.
- **worker-pool**: Background jobs. SEV2 if degraded.
- **cdn**: Static assets. SEV3 if degraded.
`;

// ---------------------------------------------------------------------------
// Automation: health-check
// ---------------------------------------------------------------------------

export const HEALTH_CHECK_AUTOMATION = `# Automation: Daily Health Check

Schedule: 0 8 * * *

## Check
Query the statuspage API for current component status. Report any components not in "operational" state.

## Output
Summary of component statuses with severity assessment per the oncall runbook.

## Delivery
Post to #ops-daily channel.
`;

// ---------------------------------------------------------------------------
// Mock StatusPage API
// ---------------------------------------------------------------------------

/** Deterministic mock data the API returns. */
export const MOCK_COMPONENTS = [
  {id: 'comp-1', name: 'api-gateway', status: 'operational', updated_at: '2026-03-18T08:00:00Z'},
  {id: 'comp-2', name: 'auth-service', status: 'operational', updated_at: '2026-03-18T08:00:00Z'},
  {id: 'comp-3', name: 'database-primary', status: 'degraded_performance', updated_at: '2026-03-18T09:15:00Z'},
  {id: 'comp-4', name: 'worker-pool', status: 'operational', updated_at: '2026-03-18T08:00:00Z'},
  {id: 'comp-5', name: 'cdn', status: 'operational', updated_at: '2026-03-18T08:00:00Z'},
];

export const MOCK_INCIDENTS = [
  {
    id: 'inc-42',
    name: 'Database latency spike',
    status: 'investigating',
    impact: 'minor',
    created_at: '2026-03-18T09:10:00Z',
    body: 'We are investigating elevated query latency on the primary database cluster.',
    components: ['database-primary'],
  },
];

/**
 * Create a mock StatusPage API server that returns deterministic data.
 * Returns a handle with start/stop methods.
 */
export function createMockStatusPageApi() {
  const requests: Array<{method: string; url: string}> = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? '';
    requests.push({method, url});

    const json = (data: unknown) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(data));
    };

    if (method === 'GET' && url === '/components') {
      json(MOCK_COMPONENTS);
      return;
    }

    if (method === 'GET' && url === '/incidents') {
      json(MOCK_INCIDENTS);
      return;
    }

    const incidentMatch = /^\/incidents\/([^/]+)$/.exec(url);
    if (method === 'GET' && incidentMatch) {
      const incident = MOCK_INCIDENTS.find((i) => i.id === incidentMatch[1]);
      if (incident) {
        json(incident);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({error: 'Not found'}));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({error: 'Not found'}));
  });

  let port = 0;

  return {
    server,
    requests,
    get port() { return port; },
    start: () => new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(port);
      });
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
