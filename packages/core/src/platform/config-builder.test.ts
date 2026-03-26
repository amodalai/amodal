/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { buildPlatformConfigParams } from './config-builder.js';
import type { AgentSDKConfig } from './platform-types.js';
import type { HttpToolConfig } from '../tools/http-tool-types.js';
import type { ChainToolConfig } from '../tools/chain-tool-types.js';
import type { FunctionToolConfig } from '../tools/function-tool-types.js';
import type { RoleDefinition } from '../roles/role-types.js';
import type { AutomationDefinition } from '../versions/version-bundle-types.js';

function makeVersionConfig() {
  return {
    httpToolConfigs: [
      { name: 'get_devices' } as unknown as HttpToolConfig,
    ],
    chainToolConfigs: [
      { name: 'get_detail' } as unknown as ChainToolConfig,
    ],
    functionToolConfigs: [
      { name: 'compute_risk' } as unknown as FunctionToolConfig,
    ],
    functionToolHandlers: new Map([['compute_risk', vi.fn()]]),
    roleDefinitions: [
      { name: 'analyst', tools: ['get_devices'] } as unknown as RoleDefinition,
    ],
    skills: [{ name: 'triage', description: 'Triage', body: '# Triage' }],
    automations: [] as AutomationDefinition[],
    version: '1.2.3',
  };
}

function makeSdkConfig(overrides: Partial<AgentSDKConfig> = {}): AgentSDKConfig {
  return {
    connections: {
      device_api: { base_url: 'https://api.example.com', api_key: 'sk-123' },
    },
    activeRole: 'analyst',
    auditConfig: { enabled: true, outputs: ['console'] },
    auditUser: 'user-1',
    auditSource: 'interactive',
    ...overrides,
  };
}

describe('buildPlatformConfigParams', () => {
  it('merges version config and SDK config', () => {
    const result = buildPlatformConfigParams(
      makeVersionConfig(),
      makeSdkConfig(),
    );

    expect(result.httpToolConfigs).toHaveLength(1);
    expect(result.chainToolConfigs).toHaveLength(1);
    expect(result.functionToolConfigs).toHaveLength(1);
    expect(result.functionToolHandlers?.size).toBe(1);
    expect(result.roleDefinitions).toHaveLength(1);
    expect(result.auditVersion).toBe('1.2.3');
    expect(result.versionBundleVersion).toBe('1.2.3');
    expect(result.connections?.['device_api']).toBeDefined();
    expect(result.activeRole).toBe('analyst');
    expect(result.auditConfig).toEqual({ enabled: true, outputs: ['console'] });
    expect(result.auditUser).toBe('user-1');
    expect(result.auditSource).toBe('interactive');
  });

  it('returns only SDK fields when versionConfig is null', () => {
    const result = buildPlatformConfigParams(null, makeSdkConfig());

    expect(result.connections?.['device_api']).toBeDefined();
    expect(result.activeRole).toBe('analyst');
    expect(result.auditConfig).toEqual({ enabled: true, outputs: ['console'] });
    expect(result.httpToolConfigs).toBeUndefined();
    expect(result.chainToolConfigs).toBeUndefined();
    expect(result.functionToolConfigs).toBeUndefined();
    expect(result.functionToolHandlers).toBeUndefined();
    expect(result.roleDefinitions).toBeUndefined();
    expect(result.auditVersion).toBeUndefined();
    expect(result.versionBundleVersion).toBeUndefined();
  });

  it('omits connections when not provided in SDK config', () => {
    const result = buildPlatformConfigParams(
      makeVersionConfig(),
      makeSdkConfig({ connections: undefined }),
    );

    expect(result.connections).toBeUndefined();
  });

  it('omits activeRole when not provided in SDK config', () => {
    const result = buildPlatformConfigParams(
      makeVersionConfig(),
      makeSdkConfig({ activeRole: undefined }),
    );

    expect(result.activeRole).toBeUndefined();
  });

  it('omits audit fields when not provided in SDK config', () => {
    const result = buildPlatformConfigParams(
      makeVersionConfig(),
      makeSdkConfig({
        auditConfig: undefined,
        auditUser: undefined,
        auditSource: undefined,
      }),
    );

    expect(result.auditConfig).toBeUndefined();
    expect(result.auditUser).toBeUndefined();
    expect(result.auditSource).toBeUndefined();
  });

  it('uses bundle version as auditVersion', () => {
    const versionConfig = makeVersionConfig();
    versionConfig.version = '5.6.7';

    const result = buildPlatformConfigParams(versionConfig, makeSdkConfig());

    expect(result.auditVersion).toBe('5.6.7');
    expect(result.versionBundleVersion).toBe('5.6.7');
  });

  it('handles empty version config arrays', () => {
    const versionConfig = makeVersionConfig();
    versionConfig.httpToolConfigs = [];
    versionConfig.chainToolConfigs = [];
    versionConfig.functionToolConfigs = [];
    versionConfig.functionToolHandlers = new Map();
    versionConfig.roleDefinitions = [];

    const result = buildPlatformConfigParams(versionConfig, makeSdkConfig());

    expect(result.httpToolConfigs).toEqual([]);
    expect(result.chainToolConfigs).toEqual([]);
    expect(result.functionToolConfigs).toEqual([]);
    expect(result.functionToolHandlers?.size).toBe(0);
    expect(result.roleDefinitions).toEqual([]);
  });

  it('handles minimal SDK config', () => {
    const result = buildPlatformConfigParams(makeVersionConfig(), {});

    expect(result.connections).toBeUndefined();
    expect(result.activeRole).toBeUndefined();
    expect(result.auditConfig).toBeUndefined();
    expect(result.httpToolConfigs).toHaveLength(1);
    expect(result.auditVersion).toBe('1.2.3');
  });

  it('handles both null versionConfig and empty SDK config', () => {
    const result = buildPlatformConfigParams(null, {});

    expect(result).toEqual({});
  });

  it('populates bundleSkills from versionConfig', () => {
    const result = buildPlatformConfigParams(
      makeVersionConfig(),
      makeSdkConfig(),
    );

    expect(result.bundleSkills).toHaveLength(1);
    expect(result.bundleSkills?.[0]).toEqual({
      name: 'triage',
      description: 'Triage',
      body: '# Triage',
    });
  });

  it('populates automationDefinitions from versionConfig', () => {
    const versionConfig = makeVersionConfig();
    versionConfig.automations = [
      {
        name: 'zone_monitor',
        trigger: { type: 'cron', schedule: '*/5 * * * *' },
        prompt: 'Check zones',
        tools: ['query_devices'],
        skills: ['*'],
        output: { channel: 'webhook', target: 'https://example.com/hook' },
        allow_writes: false,
      },
    ] as AutomationDefinition[];

    const result = buildPlatformConfigParams(versionConfig, makeSdkConfig());

    expect(result.automationDefinitions).toHaveLength(1);
    expect(result.automationDefinitions?.[0]).toEqual(
      expect.objectContaining({ name: 'zone_monitor' }),
    );
  });

  it('leaves bundleSkills and automationDefinitions undefined when versionConfig is null', () => {
    const result = buildPlatformConfigParams(null, makeSdkConfig());

    expect(result.bundleSkills).toBeUndefined();
    expect(result.automationDefinitions).toBeUndefined();
  });

  it('handles empty bundleSkills and automationDefinitions arrays', () => {
    const versionConfig = makeVersionConfig();
    versionConfig.skills = [];
    versionConfig.automations = [];

    const result = buildPlatformConfigParams(versionConfig, makeSdkConfig());

    expect(result.bundleSkills).toEqual([]);
    expect(result.automationDefinitions).toEqual([]);
  });

  it('includes platformApiUrl and platformApiKey from sdkConfig.platform', () => {
    const result = buildPlatformConfigParams(
      null,
      makeSdkConfig({
        platform: {
          apiUrl: 'https://platform.example.com',
          apiKey: 'sk-platform-key',
          deployment: 'prod',
        },
      }),
    );

    expect(result.platformApiUrl).toBe('https://platform.example.com');
    expect(result.platformApiKey).toBe('sk-platform-key');
  });

  it('omits platform credentials when platform not set in sdkConfig', () => {
    const result = buildPlatformConfigParams(null, makeSdkConfig());

    expect(result.platformApiUrl).toBeUndefined();
    expect(result.platformApiKey).toBeUndefined();
  });

  it('includes applicationId and tenantId from sdkConfig', () => {
    const result = buildPlatformConfigParams(
      null,
      makeSdkConfig({ applicationId: 'app-abc', tenantId: 'ten-xyz' }),
    );

    expect(result.applicationId).toBe('app-abc');
    expect(result.tenantId).toBe('ten-xyz');
  });

  it('omits applicationId and tenantId when not set in sdkConfig', () => {
    const result = buildPlatformConfigParams(null, makeSdkConfig());

    expect(result.applicationId).toBeUndefined();
    expect(result.tenantId).toBeUndefined();
  });

  it('includes agentContext from sdkConfig', () => {
    const result = buildPlatformConfigParams(
      null,
      makeSdkConfig({ agentContext: 'You monitor wireless devices.' }),
    );

    expect(result.agentContext).toBe('You monitor wireless devices.');
  });

  it('omits agentContext when not set in sdkConfig', () => {
    const result = buildPlatformConfigParams(null, makeSdkConfig());

    expect(result.agentContext).toBeUndefined();
  });

  it('preserves multiple connections', () => {
    const result = buildPlatformConfigParams(
      null,
      makeSdkConfig({
        connections: {
          device_api: { base_url: 'https://devices.example.com' },
          alert_api: { base_url: 'https://alerts.example.com' },
        },
      }),
    );

    expect(Object.keys(result.connections ?? {})).toHaveLength(2);
    expect(result.connections?.['device_api']).toBeDefined();
    expect(result.connections?.['alert_api']).toBeDefined();
  });
});
