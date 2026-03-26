/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  AutomationTriggerSchema,
  AutomationOutputSchema,
  AutomationConstraintsSchema,
  AutomationDefinitionSchema,
  BundleToolConfigSchema,
  BundleHandlerSchema,
  BundleDependenciesSchema,
  BundleSkillSchema,
  VersionBundleSchema,
} from './version-bundle-types.js';

describe('AutomationTriggerSchema', () => {
  it('accepts a cron trigger', () => {
    const result = AutomationTriggerSchema.parse({
      type: 'cron',
      schedule: '*/5 * * * *',
    });
    expect(result.type).toBe('cron');
    expect(result).toHaveProperty('schedule', '*/5 * * * *');
  });

  it('accepts a webhook trigger', () => {
    const result = AutomationTriggerSchema.parse({
      type: 'webhook',
      source: 'restricted_zone',
    });
    expect(result.type).toBe('webhook');
    expect(result).toHaveProperty('source', 'restricted_zone');
  });

  it('accepts a webhook trigger with filter', () => {
    const result = AutomationTriggerSchema.parse({
      type: 'webhook',
      source: 'restricted_zone',
      filter: 'severity >= high',
    });
    expect(result).toHaveProperty('filter', 'severity >= high');
  });

  it('rejects unknown trigger type', () => {
    expect(() =>
      AutomationTriggerSchema.parse({ type: 'unknown', foo: 'bar' }),
    ).toThrow();
  });

  it('rejects cron without schedule', () => {
    expect(() =>
      AutomationTriggerSchema.parse({ type: 'cron' }),
    ).toThrow();
  });
});

describe('AutomationOutputSchema', () => {
  it('accepts slack channel', () => {
    const result = AutomationOutputSchema.parse({
      channel: 'slack',
      target: '#security-alerts',
    });
    expect(result.channel).toBe('slack');
    expect(result.target).toBe('#security-alerts');
  });

  it('rejects unknown channel', () => {
    expect(() =>
      AutomationOutputSchema.parse({ channel: 'sms', target: '+1234567890' }),
    ).toThrow();
  });
});

describe('AutomationConstraintsSchema', () => {
  it('accepts all optional fields', () => {
    const result = AutomationConstraintsSchema.parse({
      max_tool_calls: 10,
      timeout_seconds: 60,
      max_tokens: 4096,
    });
    expect(result.max_tool_calls).toBe(10);
    expect(result.timeout_seconds).toBe(60);
    expect(result.max_tokens).toBe(4096);
  });

  it('accepts empty constraints', () => {
    const result = AutomationConstraintsSchema.parse({});
    expect(result.max_tool_calls).toBeUndefined();
  });
});

describe('AutomationDefinitionSchema', () => {
  const validAutomation = {
    name: 'zone_monitor',
    trigger: { type: 'cron' as const, schedule: '*/5 * * * *' },
    prompt: 'Check for anomalies in assigned zones',
    tools: ['query_devices', 'get_anomalies'],
    output: { channel: 'slack' as const, target: '#alerts' },
  };

  it('accepts a valid automation', () => {
    const result = AutomationDefinitionSchema.parse(validAutomation);
    expect(result.name).toBe('zone_monitor');
    expect(result.allow_writes).toBe(false);
    expect(result.skills).toEqual(['*']);
  });

  it('rejects automation without tools', () => {
    expect(() =>
      AutomationDefinitionSchema.parse({ ...validAutomation, tools: [] }),
    ).toThrow();
  });

  it('defaults allow_writes to false', () => {
    const result = AutomationDefinitionSchema.parse(validAutomation);
    expect(result.allow_writes).toBe(false);
  });
});

describe('BundleToolConfigSchema', () => {
  it('accepts an HTTP tool', () => {
    const result = BundleToolConfigSchema.parse({
      type: 'http',
      name: 'query_devices',
      displayName: 'Query Devices',
      description: 'Query devices in a zone',
      method: 'GET',
      urlTemplate: '{{connections.api.base_url}}/devices',
      parameters: { type: 'object' },
    });
    expect(result.type).toBe('http');
  });

  it('accepts a chain tool', () => {
    const result = BundleToolConfigSchema.parse({
      type: 'chain',
      name: 'get_device_detail',
      displayName: 'Get Device Detail',
      description: 'Get device info with trajectory',
      steps: [
        {
          name: 'info',
          method: 'GET',
          urlTemplate: '{{connections.api.base_url}}/devices/{{params.id}}',
        },
      ],
      merge: '{{steps.info}}',
      parameters: { type: 'object' },
    });
    expect(result.type).toBe('chain');
  });

  it('accepts a function tool', () => {
    const result = BundleToolConfigSchema.parse({
      type: 'function',
      name: 'compute_risk',
      displayName: 'Compute Risk',
      description: 'Compute risk score',
      handler: 'compute-risk',
      parameters: { type: 'object' },
    });
    expect(result.type).toBe('function');
  });

  it('rejects unknown tool type', () => {
    expect(() =>
      BundleToolConfigSchema.parse({
        type: 'graphql',
        name: 'test',
        displayName: 'Test',
        description: 'Test',
        parameters: {},
      }),
    ).toThrow();
  });
});

describe('BundleHandlerSchema', () => {
  it('accepts a valid handler', () => {
    const result = BundleHandlerSchema.parse({
      entry: 'compute-risk.ts',
      files: {
        'compute-risk.ts': 'export default async () => {};',
      },
    });
    expect(result.entry).toBe('compute-risk.ts');
  });

  it('accepts handler with empty files record', () => {
    // Empty files is valid at schema level; handler import will fail at runtime
    const result = BundleHandlerSchema.parse({ entry: 'main.ts', files: {} });
    expect(result.files).toEqual({});
  });

  it('rejects handler without entry', () => {
    expect(() =>
      BundleHandlerSchema.parse({ files: { 'main.ts': 'code' } }),
    ).toThrow();
  });
});

describe('BundleDependenciesSchema', () => {
  it('accepts full dependencies', () => {
    const result = BundleDependenciesSchema.parse({
      npm: { lodash: '4.17.21' },
      pip: { numpy: '1.24.0' },
      system: ['ffmpeg'],
    });
    expect(result.npm).toEqual({ lodash: '4.17.21' });
    expect(result.pip).toEqual({ numpy: '1.24.0' });
    expect(result.system).toEqual(['ffmpeg']);
  });

  it('defaults all fields to undefined', () => {
    const result = BundleDependenciesSchema.parse({});
    expect(result.npm).toBeUndefined();
    expect(result.pip).toBeUndefined();
    expect(result.system).toBeUndefined();
  });
});

describe('BundleSkillSchema', () => {
  it('accepts a valid skill', () => {
    const result = BundleSkillSchema.parse({
      name: 'triage',
      description: 'Triage incoming events',
      body: '# Triage Skill\n\nAnalyze the event queue...',
    });
    expect(result.name).toBe('triage');
  });

  it('rejects skill without body', () => {
    expect(() =>
      BundleSkillSchema.parse({ name: 'test', description: 'test' }),
    ).toThrow();
  });
});

describe('VersionBundleSchema', () => {
  const minimalBundle = {
    version: '1.0.0',
  };

  it('accepts a minimal bundle', () => {
    const result = VersionBundleSchema.parse(minimalBundle);
    expect(result.version).toBe('1.0.0');
    expect(result.tools).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.handlers).toEqual({});
    expect(result.dependencies).toEqual({});
    expect(result.roles).toEqual([]);
    expect(result.automations).toEqual([]);
  });

  it('accepts a full bundle', () => {
    const result = VersionBundleSchema.parse({
      version: '2.1.0',
      published_at: '2025-01-15T10:00:00Z',
      published_by: 'admin@company.com',
      tools: [
        {
          type: 'http',
          name: 'query_devices',
          displayName: 'Query Devices',
          description: 'Query devices',
          method: 'GET',
          urlTemplate: 'https://api.example.com/devices',
          parameters: {},
        },
      ],
      skills: [
        { name: 'triage', description: 'Triage events', body: '# Triage' },
      ],
      handlers: {
        'compute-risk': {
          entry: 'index.ts',
          files: { 'index.ts': 'export default async () => ({});' },
        },
      },
      dependencies: { npm: { lodash: '4.17.21' } },
      roles: [{ name: 'analyst', tools: ['query_devices'] }],
      automations: [
        {
          name: 'zone_monitor',
          trigger: { type: 'cron', schedule: '*/5 * * * *' },
          prompt: 'Check zones',
          tools: ['query_devices'],
          output: { channel: 'slack', target: '#alerts' },
        },
      ],
    });
    expect(result.version).toBe('2.1.0');
    expect(result.tools).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result.roles).toHaveLength(1);
    expect(result.automations).toHaveLength(1);
  });

  it('rejects bundle without version', () => {
    expect(() => VersionBundleSchema.parse({})).toThrow();
  });

  it('rejects bundle with invalid tool type', () => {
    expect(() =>
      VersionBundleSchema.parse({
        version: '1.0.0',
        tools: [{ type: 'invalid', name: 'x' }],
      }),
    ).toThrow();
  });
});
