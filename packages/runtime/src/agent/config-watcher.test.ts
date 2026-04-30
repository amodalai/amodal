/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// Use a fresh mock for each import
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: vi.fn().mockReturnValue({close: vi.fn()}),
  };
});

vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    loadRepo: vi.fn().mockResolvedValue({
      source: 'local',
      origin: '/test',
      config: {name: 'test', version: '1.0.0', models: {main: {provider: 'anthropic', model: 'test'}}},
      connections: new Map(),
      skills: [],
      agents: {},
      automations: [],
      knowledge: [],
      evals: [],
      tools: [],
    }),
  };
});

describe('ConfigWatcher', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let fs: typeof import('node:fs');

  beforeEach(async () => {
    vi.useFakeTimers();
    onChange = vi.fn();

    // Get the mocked fs module
    fs = await import('node:fs');
    vi.mocked(fs.watch).mockClear();
    vi.mocked(fs.watch).mockReturnValue({close: vi.fn()} as unknown as ReturnType<typeof fs.watch>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should watch agent config dirs, package.json, and .amodal/', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');
    const watcher = new ConfigWatcher('/repo', onChange);
    watcher.start();

    // Should have called watch multiple times (one per target that doesn't throw)
    expect(vi.mocked(fs.watch).mock.calls.length).toBeGreaterThan(1);

    // Verify paths include amodal.json, skills, connections, .amodal, package.json
    const paths = vi.mocked(fs.watch).mock.calls.map((c) => c[0]);
    expect(paths).toContainEqual('/repo/amodal.json');
    expect(paths).toContainEqual('/repo/skills');
    expect(paths).toContainEqual('/repo/connections');
    expect(paths).toContainEqual('/repo/.amodal');
    expect(paths).toContainEqual('/repo/package.json');

    watcher.stop();
  });

  it('should not start twice', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');
    const watcher = new ConfigWatcher('/repo', onChange);
    watcher.start();
    const callCount = vi.mocked(fs.watch).mock.calls.length;
    watcher.start();

    expect(vi.mocked(fs.watch).mock.calls.length).toBe(callCount);
    watcher.stop();
  });

  it('should stop without error when not started', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');
    const watcher = new ConfigWatcher('/repo', onChange);
    // Should not throw
    watcher.stop();
  });

  it('should establish watchers for directories that appear after reload', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');

    // First call to watch: ENOENT for knowledge/, success for amodal.json
    let callCount = 0;
    vi.mocked(fs.watch).mockImplementation(((path: string) => {
      callCount++;
      if (String(path).includes('knowledge') && callCount <= 11) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return {close: vi.fn()};
    }) as unknown as typeof fs.watch);

    const watcher = new ConfigWatcher('/repo', onChange);
    watcher.start();

    const initialCalls = vi.mocked(fs.watch).mock.calls.filter(
      (c) => String(c[0]).includes('knowledge'),
    );
    // knowledge/ watch should have failed
    expect(initialCalls.length).toBe(1);

    // Trigger a reload (simulates config change after clone creates knowledge/)
    const watchCall = vi.mocked(fs.watch).mock.calls[0] as unknown[];
    const callback = watchCall?.[2] as ((event: string, filename: string) => void) | undefined;
    if (callback) callback('change', 'amodal.json');

    await vi.advanceTimersByTimeAsync(400);

    // After reload, refreshWatchers should retry and succeed for knowledge/
    const knowledgeCalls = vi.mocked(fs.watch).mock.calls.filter(
      (c) => String(c[0]).includes('knowledge'),
    );
    expect(knowledgeCalls.length).toBe(2);

    watcher.stop();
  });

  it('should re-throw non-ENOENT errors from fs.watch', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');

    vi.mocked(fs.watch).mockImplementation((() => {
      throw new Error('EPERM: permission denied');
    }) as unknown as typeof fs.watch);

    const watcher = new ConfigWatcher('/repo', onChange);
    expect(() => watcher.start()).toThrow('EPERM');
  });

  it('should debounce reload on file changes', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');
    const watcher = new ConfigWatcher('/repo', onChange);
    watcher.start();

    // Get the callback from the first watch() call
    const watchCall = vi.mocked(fs.watch).mock.calls[0] as unknown[];
    const callback = watchCall?.[2] as ((event: string, filename: string) => void) | undefined;

    if (callback) {
      callback('change', 'config.json');
      callback('change', 'config.json');
      callback('change', 'config.json');
    }

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(400);

    // Should have called onChange only once (debounced)
    expect(onChange).toHaveBeenCalledTimes(1);

    watcher.stop();
  });
});
