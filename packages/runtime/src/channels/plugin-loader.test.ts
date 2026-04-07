/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {loadChannelPlugins} from './plugin-loader.js';
import {ChannelPluginError, ChannelConfigError} from './errors.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Helper — no local channels dir exists at this fake path. */
const NO_LOCAL = '/tmp/nonexistent-repo-path';

/**
 * Create a fake npm channel package in a temp directory so that
 * the file-based resolution in plugin-loader can find it.
 */
function createFakePackage(
  repoPath: string,
  packageName: string,
  pluginModule: string,
): void {
  const pkgDir = path.join(repoPath, 'node_modules', ...packageName.split('/'));
  const distDir = path.join(pkgDir, 'dist');
  mkdirSync(distDir, {recursive: true});
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({name: packageName, main: 'dist/index.mjs'}));
  writeFileSync(path.join(distDir, 'index.mjs'), pluginModule);
}

const TEMP_REPO = '/tmp/plugin-loader-test-repo';

beforeEach(() => {
  mkdirSync(TEMP_REPO, {recursive: true});
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(TEMP_REPO, {recursive: true, force: true});
});

describe('loadChannelPlugins', () => {
  it('throws ChannelPluginError for missing package (no local, no npm)', async () => {
    await expect(
      loadChannelPlugins({
        channelsConfig: {'nonexistent-channel': {}},
        repoPath: NO_LOCAL,
        logger: mockLogger as never,
      }),
    ).rejects.toThrow(ChannelPluginError);
  });

  it('throws ChannelPluginError for invalid plugin export', async () => {
    createFakePackage(TEMP_REPO, '@amodalai/channel-badshape', 'export default {notAPlugin: true};');

    await expect(
      loadChannelPlugins({
        channelsConfig: {badshape: {}},
        repoPath: TEMP_REPO,
        packages: ['@amodalai/channel-badshape'],
        logger: mockLogger as never,
      }),
    ).rejects.toThrow(ChannelPluginError);
  });

  it('throws ChannelConfigError for invalid config', async () => {
    // Inline config schema that rejects anything without 'required' field
    const pluginCode = `
      export default {
        channelType: 'testvalid',
        configSchema: {
          parse(data) {
            if (!data || typeof data.required !== 'string') throw new Error('missing required field');
            return data;
          },
        },
        createAdapter: (cfg) => ({channelType: 'testvalid', parseIncoming: async () => null, sendMessage: async () => {}}),
      };
    `;
    createFakePackage(TEMP_REPO, '@amodalai/channel-testvalid', pluginCode);

    await expect(
      loadChannelPlugins({
        channelsConfig: {testvalid: {wrong: 'field'}},
        repoPath: TEMP_REPO,
        packages: ['@amodalai/channel-testvalid'],
        logger: mockLogger as never,
      }),
    ).rejects.toThrow(ChannelConfigError);
  });

  it('loads a valid npm plugin and returns adapter map', async () => {
    const pluginCode = `
      export default {
        channelType: 'testok',
        configSchema: { parse(data) { return data; } },
        createAdapter: () => ({channelType: 'testok', parseIncoming: async () => null, sendMessage: async () => {}}),
      };
    `;
    createFakePackage(TEMP_REPO, '@amodalai/channel-testok', pluginCode);

    const adapters = await loadChannelPlugins({
      channelsConfig: {testok: {token: 'abc'}},
      repoPath: TEMP_REPO,
      packages: ['@amodalai/channel-testok'],
      logger: mockLogger as never,
    });
    expect(adapters.size).toBe(1);
    expect(adapters.get('testok')).toBeDefined();
    expect(adapters.get('testok')?.channelType).toBe('testok');
  });

  it('error message mentions both local and npm when channel not found', async () => {
    try {
      await loadChannelPlugins({
        channelsConfig: {missing: {}},
        repoPath: NO_LOCAL,
        logger: mockLogger as never,
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ChannelPluginError);
      const msg = (err as ChannelPluginError).message;
      expect(msg).toContain('channels/missing/index.ts');
      expect(msg).toContain('channel-missing');
    }
  });
});
