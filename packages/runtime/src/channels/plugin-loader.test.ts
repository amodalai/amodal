/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
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
    vi.doMock('@amodalai/channel-badshape', () => ({
      default: {notAPlugin: true},
    }));

    await expect(
      loadChannelPlugins({
        channelsConfig: {badshape: {}},
        repoPath: NO_LOCAL,
        logger: mockLogger as never,
      }),
    ).rejects.toThrow(ChannelPluginError);

    vi.doUnmock('@amodalai/channel-badshape');
  });

  it('throws ChannelConfigError for invalid config', async () => {
    const {z} = await import('zod');
    vi.doMock('@amodalai/channel-testvalid', () => ({
      default: {
        channelType: 'testvalid',
        configSchema: z.object({required: z.string()}),
        createAdapter: () => ({channelType: 'testvalid', parseIncoming: vi.fn(), sendMessage: vi.fn()}),
      },
    }));

    await expect(
      loadChannelPlugins({
        channelsConfig: {testvalid: {wrong: 'field'}},
        repoPath: NO_LOCAL,
        logger: mockLogger as never,
      }),
    ).rejects.toThrow(ChannelConfigError);

    vi.doUnmock('@amodalai/channel-testvalid');
  });

  it('loads a valid npm plugin and returns adapter map', async () => {
    const mockAdapter = {channelType: 'testok', parseIncoming: vi.fn(), sendMessage: vi.fn()};
    const {z} = await import('zod');
    vi.doMock('@amodalai/channel-testok', () => ({
      default: {
        channelType: 'testok',
        configSchema: z.object({token: z.string()}),
        createAdapter: () => mockAdapter,
      },
    }));

    const adapters = await loadChannelPlugins({
      channelsConfig: {testok: {token: 'abc'}},
      repoPath: NO_LOCAL,
      logger: mockLogger as never,
    });
    expect(adapters.size).toBe(1);
    expect(adapters.get('testok')).toBe(mockAdapter);

    vi.doUnmock('@amodalai/channel-testok');
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
      expect(msg).toContain('amodal channels install');
    }
  });
});
