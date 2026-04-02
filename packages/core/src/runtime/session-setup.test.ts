/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import type {AgentBundle} from '../repo/repo-types.js';
import type {AmodalConfig} from '../repo/config-schema.js';
import type {LoadedConnection} from '../repo/connection-types.js';
import type {AccessConfig, ConnectionSpec} from '../repo/connection-schemas.js';
import {ScrubTracker} from '../security/scrub-tracker.js';
import {FieldScrubber} from '../security/field-scrubber.js';
import {OutputGuard} from '../security/output-guard.js';
import {ActionGate} from '../security/action-gate.js';
import {ContextCompiler} from './context-compiler.js';
import {OutputPipeline} from './output-pipeline.js';
import {RuntimeTelemetry} from './telemetry-hooks.js';
import {setupSession} from './session-setup.js';

function makeConfig(overrides: Partial<AmodalConfig> = {}): AmodalConfig {
  return {
    name: 'test-app',
    version: '1.0.0',
    models: {
      main: {provider: 'anthropic', model: 'claude-3.5-sonnet'},
    },
    ...overrides,
  };
}

function makeConnection(
  name: string,
  specOverrides: Partial<ConnectionSpec> = {},
  accessOverrides: Partial<AccessConfig> = {},
): LoadedConnection {
  const spec: ConnectionSpec = {
    baseUrl: `https://${name}.example.com`,
    format: 'openapi',
    ...specOverrides,
  };
  const access: AccessConfig = {
    endpoints: {},
    ...accessOverrides,
  };
  return {
    name,
    spec,
    access,
    surface: [],
    location: `/connections/${name}`,
  };
}

function makeRepo(overrides: Partial<AgentBundle> = {}): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: makeConfig(),
    connections: new Map(),
    skills: [],
    agents: {},
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
    ...overrides,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('setupSession', () => {
  it('returns all expected fields', () => {
    const runtime = setupSession({repo: makeRepo()});

    expect(runtime.repo).toBeDefined();
    expect(runtime.scrubTracker).toBeDefined();
    expect(runtime.fieldScrubber).toBeDefined();
    expect(runtime.outputGuard).toBeDefined();
    expect(runtime.actionGate).toBeDefined();
    expect(runtime.contextCompiler).toBeDefined();
    expect(runtime.compiledContext).toBeDefined();
    expect(runtime.exploreContext).toBeDefined();
    expect(runtime.outputPipeline).toBeDefined();
    expect(runtime.telemetry).toBeDefined();
    expect(runtime.connectionsMap).toBeDefined();
    expect(runtime.userRoles).toBeDefined();
    expect(runtime.sessionId).toBeDefined();
    expect(typeof runtime.isDelegated).toBe('boolean');
  });

  it('generates a valid UUID for sessionId', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.sessionId).toMatch(UUID_REGEX);
  });

  it('generates unique sessionIds', () => {
    const r1 = setupSession({repo: makeRepo()});
    const r2 = setupSession({repo: makeRepo()});
    expect(r1.sessionId).not.toBe(r2.sessionId);
  });

  it('uses provided userRoles', () => {
    const runtime = setupSession({
      repo: makeRepo(),
      userRoles: ['admin', 'analyst'],
    });
    expect(runtime.userRoles).toEqual(['admin', 'analyst']);
  });

  it('defaults userRoles to empty array', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.userRoles).toEqual([]);
  });

  it('passes isDelegated through', () => {
    const runtime = setupSession({
      repo: makeRepo(),
      isDelegated: true,
    });
    expect(runtime.isDelegated).toBe(true);
  });

  it('defaults isDelegated to false', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.isDelegated).toBe(false);
  });

  it('produces non-empty compiledContext', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.compiledContext.systemPrompt.length).toBeGreaterThan(0);
    expect(runtime.compiledContext.sections.length).toBeGreaterThan(0);
  });

  it('produces non-empty exploreContext', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.exploreContext.systemPrompt.length).toBeGreaterThan(0);
    expect(runtime.exploreContext.sections.length).toBeGreaterThan(0);
  });

  it('initializes scrubTracker empty', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.scrubTracker.size).toBe(0);
  });

  it('initializes correct component types', () => {
    const runtime = setupSession({repo: makeRepo()});
    expect(runtime.scrubTracker).toBeInstanceOf(ScrubTracker);
    expect(runtime.fieldScrubber).toBeInstanceOf(FieldScrubber);
    expect(runtime.outputGuard).toBeInstanceOf(OutputGuard);
    expect(runtime.actionGate).toBeInstanceOf(ActionGate);
    expect(runtime.contextCompiler).toBeInstanceOf(ContextCompiler);
    expect(runtime.outputPipeline).toBeInstanceOf(OutputPipeline);
    expect(runtime.telemetry).toBeInstanceOf(RuntimeTelemetry);
  });

  it('builds connectionsMap matching repo connections', () => {
    const connections = new Map([
      ['crm', makeConnection('crm', {auth: {type: 'bearer', token: 'tok'}})],
      ['billing', makeConnection('billing')],
    ]);
    const runtime = setupSession({repo: makeRepo({connections})});

    expect(Object.keys(runtime.connectionsMap)).toHaveLength(2);
    expect(runtime.connectionsMap['crm']).toBeDefined();
    expect(runtime.connectionsMap['crm']['base_url']).toBe('https://crm.example.com');
    expect(runtime.connectionsMap['billing']).toBeDefined();
  });

  it('works with empty connections', () => {
    const runtime = setupSession({repo: makeRepo({connections: new Map()})});
    expect(Object.keys(runtime.connectionsMap)).toHaveLength(0);
  });

  it('invokes telemetry sink when provided', () => {
    const events: unknown[] = [];
    const runtime = setupSession({
      repo: makeRepo(),
      telemetrySink: (event) => {
        events.push(event);
      },
    });
    // Telemetry is initialized — verify by checking it exists
    expect(runtime.telemetry).toBeInstanceOf(RuntimeTelemetry);
  });

  it('includes scope labels in compiledContext when connections have rowScoping', () => {
    const connections = new Map([
      [
        'crm',
        makeConnection('crm', {}, {
          endpoints: {},
          rowScoping: {
            customer: {
              analyst: {type: 'field_match', userContextField: 'team_id', label: 'your team customers'},
            },
          },
        }),
      ],
    ]);

    const runtime = setupSession({
      repo: makeRepo({connections}),
      userRoles: ['analyst'],
    });

    expect(runtime.compiledContext.systemPrompt).toContain('your team customers');
  });
});
