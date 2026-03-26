/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { VersionManager } from './version-manager.js';
import * as bundleLoader from './bundle-loader.js';
import * as dependencyManager from './dependency-manager.js';
import * as handlerLoader from './handler-loader.js';
import type { VersionBundle } from './version-bundle-types.js';
import type { AuditLogger } from '../audit/audit-logger.js';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./bundle-loader.js', () => ({
  loadBundle: vi.fn(),
}));

vi.mock('./dependency-manager.js', () => ({
  diffDependencies: vi.fn().mockReturnValue({
    npm: { added: {}, removed: [], changed: {} },
    pip: { added: {}, removed: [], changed: {} },
    system: { added: [], removed: [] },
  }),
  installDependencies: vi.fn().mockResolvedValue({
    npmInstalled: false,
    pipInstalled: false,
    missingBinaries: [],
  }),
}));

vi.mock('./handler-loader.js', () => ({
  loadHandlers: vi.fn().mockResolvedValue(new Map()),
}));

function createMinimalBundle(overrides?: Partial<VersionBundle>): VersionBundle {
  return {
    version: '1.0.0',
    tools: [],
    skills: [],
    handlers: {},
    dependencies: {},
    roles: [],
    automations: [],
    ...overrides,
  };
}

describe('VersionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with no current version', () => {
    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    expect(manager.currentVersion).toBeNull();
  });

  it('loads a minimal bundle successfully', async () => {
    const bundle = createMinimalBundle();
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(bundle);

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    const loaded = await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(loaded.bundle.version).toBe('1.0.0');
    expect(loaded.versionDir).toBe('/tmp/sdk/versions/1.0.0');
    expect(loaded.handlerMap.size).toBe(0);
    expect(loaded.httpToolConfigs).toEqual([]);
    expect(loaded.chainToolConfigs).toEqual([]);
    expect(loaded.functionToolConfigs).toEqual([]);
    expect(loaded.skills).toEqual([]);
    expect(loaded.roles).toEqual([]);
    expect(loaded.automations).toEqual([]);
    expect(loaded.loadedAt).toBeInstanceOf(Date);
  });

  it('creates version directory', async () => {
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(createMinimalBundle());

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(mkdir).toHaveBeenCalledWith('/tmp/sdk/versions/1.0.0', {
      recursive: true,
    });
  });

  it('separates tool configs by type', async () => {
    const bundle = createMinimalBundle({
      tools: [
        {
          type: 'http',
          name: 'query_devices',
          displayName: 'Query Devices',
          description: 'Query devices',
          method: 'GET',
          urlTemplate: 'https://api.example.com/devices',
          parameters: {},
          timeout: 30000,
        },
        {
          type: 'chain',
          name: 'get_detail',
          displayName: 'Get Detail',
          description: 'Get device detail',
          steps: [
            {
              name: 'info',
              method: 'GET',
              urlTemplate: 'https://api.example.com/devices/1',
              timeout: 30000,
            },
          ],
          merge: '{{steps.info}}',
          parameters: {},
          timeout: 60000,
        },
        {
          type: 'function',
          name: 'compute_risk',
          displayName: 'Compute Risk',
          description: 'Compute risk',
          handler: 'compute-risk',
          parameters: {},
          timeout: 30000,
        },
      ],
    });
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(bundle);

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    const loaded = await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(loaded.httpToolConfigs).toHaveLength(1);
    expect(loaded.httpToolConfigs[0].name).toBe('query_devices');
    expect(loaded.chainToolConfigs).toHaveLength(1);
    expect(loaded.chainToolConfigs[0].name).toBe('get_detail');
    expect(loaded.functionToolConfigs).toHaveLength(1);
    expect(loaded.functionToolConfigs[0].name).toBe('compute_risk');
  });

  it('strips the type field from tool configs', async () => {
    const bundle = createMinimalBundle({
      tools: [
        {
          type: 'http',
          name: 'test_tool',
          displayName: 'Test',
          description: 'Test',
          method: 'GET',
          urlTemplate: 'https://api.example.com/test',
          parameters: {},
          timeout: 30000,
        },
      ],
    });
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(bundle);

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    const loaded = await manager.loadVersion({ path: '/tmp/bundle.json' });

    // The type field should not be on the extracted config
    expect('type' in loaded.httpToolConfigs[0]).toBe(false);
  });

  it('diffs dependencies against current version', async () => {
    const v1 = createMinimalBundle({
      version: '1.0.0',
      dependencies: { npm: { lodash: '4.17.20' } },
    });
    const v2 = createMinimalBundle({
      version: '2.0.0',
      dependencies: { npm: { lodash: '4.17.21' } },
    });

    vi.mocked(bundleLoader.loadBundle)
      .mockResolvedValueOnce(v1)
      .mockResolvedValueOnce(v2);

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await manager.loadVersion({ path: '/tmp/v1.json' });
    await manager.loadVersion({ path: '/tmp/v2.json' });

    expect(dependencyManager.diffDependencies).toHaveBeenCalledWith(
      v1.dependencies,
      v2.dependencies,
    );
  });

  it('uses empty deps for first version load', async () => {
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(createMinimalBundle());

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(dependencyManager.diffDependencies).toHaveBeenCalledWith(
      {},
      {},
    );
  });

  it('throws when system binaries are missing', async () => {
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(createMinimalBundle());
    vi.mocked(dependencyManager.installDependencies).mockResolvedValue({
      npmInstalled: false,
      pipInstalled: false,
      missingBinaries: ['ffmpeg', 'ffprobe'],
    });

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await expect(
      manager.loadVersion({ path: '/tmp/bundle.json' }),
    ).rejects.toThrow('Missing system binaries: ffmpeg, ffprobe');
  });

  it('atomically swaps to new version', async () => {
    const v1 = createMinimalBundle({ version: '1.0.0' });
    const v2 = createMinimalBundle({ version: '2.0.0' });

    vi.mocked(bundleLoader.loadBundle)
      .mockResolvedValueOnce(v1)
      .mockResolvedValueOnce(v2);
    vi.mocked(dependencyManager.installDependencies).mockResolvedValue({
      npmInstalled: false,
      pipInstalled: false,
      missingBinaries: [],
    });

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await manager.loadVersion({ path: '/tmp/v1.json' });
    expect(manager.currentVersion?.bundle.version).toBe('1.0.0');

    await manager.loadVersion({ path: '/tmp/v2.json' });
    expect(manager.currentVersion?.bundle.version).toBe('2.0.0');
  });

  it('calls audit logger on successful load', async () => {
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(
      createMinimalBundle({ version: '3.0.0' }),
    );

    const mockAudit = { logVersionLoad: vi.fn() } as unknown as AuditLogger;
    const manager = new VersionManager({
      baseDir: '/tmp/sdk',
      auditLogger: mockAudit,
    });

    await manager.loadVersion({ path: '/tmp/bundle.json' });
    expect(mockAudit.logVersionLoad).toHaveBeenCalledWith('3.0.0');
  });

  it('works without audit logger', async () => {
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(createMinimalBundle());

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    // Should not throw
    await manager.loadVersion({ path: '/tmp/bundle.json' });
  });

  it('skips disabled tools during loadVersion', async () => {
    const bundle = createMinimalBundle({
      tools: [
        {
          type: 'http',
          name: 'enabled_tool',
          displayName: 'Enabled',
          description: 'Enabled tool',
          method: 'GET',
          urlTemplate: 'https://api.example.com/enabled',
          parameters: {},
          timeout: 30000,
          disabled: false,
        },
        {
          type: 'http',
          name: 'disabled_tool',
          displayName: 'Disabled',
          description: 'Disabled tool',
          method: 'GET',
          urlTemplate: 'https://api.example.com/disabled',
          parameters: {},
          timeout: 30000,
          disabled: true,
        },
      ],
    });
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(bundle);

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    const loaded = await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(loaded.httpToolConfigs).toHaveLength(1);
    expect(loaded.httpToolConfigs[0].name).toBe('enabled_tool');
  });

  it('calls loadHandlers with bundle handlers and versionDir', async () => {
    const handlers = {
      'compute-risk': {
        entry: 'index.ts',
        files: { 'index.ts': 'export default async () => {};' },
      },
    };
    vi.mocked(bundleLoader.loadBundle).mockResolvedValue(
      createMinimalBundle({ handlers }),
    );

    const manager = new VersionManager({ baseDir: '/tmp/sdk' });
    await manager.loadVersion({ path: '/tmp/bundle.json' });

    expect(handlerLoader.loadHandlers).toHaveBeenCalledWith(
      handlers,
      '/tmp/sdk/versions/1.0.0',
    );
  });

  describe('getVersionConfig', () => {
    it('returns null when no version is loaded', () => {
      const manager = new VersionManager({ baseDir: '/tmp/sdk' });
      expect(manager.getVersionConfig()).toBeNull();
    });

    it('returns config-compatible fields', async () => {
      const bundle = createMinimalBundle({
        version: '1.5.0',
        roles: [{ name: 'analyst', tools: ['query_devices'], skills: ['*'], automations: { can_view: true, can_create: false }, constraints: {} }],
        skills: [{ name: 'triage', description: 'Triage', body: '# Triage' }],
        automations: [
          {
            name: 'zone_monitor',
            trigger: { type: 'cron', schedule: '*/5 * * * *' },
            prompt: 'Check zones',
            tools: ['query_devices'],
            skills: ['*'],
            output: { channel: 'slack', target: '#alerts' },
            allow_writes: false,
          },
        ],
      });
      vi.mocked(bundleLoader.loadBundle).mockResolvedValue(bundle);

      const manager = new VersionManager({ baseDir: '/tmp/sdk' });
      await manager.loadVersion({ path: '/tmp/bundle.json' });

      const config = manager.getVersionConfig();
      expect(config).not.toBeNull();
      expect(config!.version).toBe('1.5.0');
      expect(config!.roleDefinitions).toHaveLength(1);
      expect(config!.skills).toHaveLength(1);
      expect(config!.automations).toHaveLength(1);
      expect(config!.functionToolHandlers).toBeInstanceOf(Map);
    });
  });

  describe('cleanup', () => {
    it('removes version directory', async () => {
      const manager = new VersionManager({ baseDir: '/tmp/sdk' });
      await manager.cleanup('1.0.0');

      expect(rm).toHaveBeenCalledWith('/tmp/sdk/versions/1.0.0', {
        recursive: true,
        force: true,
      });
    });
  });
});
