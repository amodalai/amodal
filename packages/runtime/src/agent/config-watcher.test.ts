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

  it('should watch agent config dirs, not .amodal/', async () => {
    const {ConfigWatcher} = await import('./config-watcher.js');
    const watcher = new ConfigWatcher('/repo', onChange);
    watcher.start();

    // Should have called watch multiple times (one per target that doesn't throw)
    expect(vi.mocked(fs.watch).mock.calls.length).toBeGreaterThan(1);

    // Verify paths include amodal.json, skills, connections
    const paths = vi.mocked(fs.watch).mock.calls.map((c) => c[0]);
    expect(paths).toContainEqual('/repo/amodal.json');
    expect(paths).toContainEqual('/repo/skills');
    expect(paths).toContainEqual('/repo/connections');

    // Should NOT watch .amodal
    expect(paths).not.toContainEqual('/repo/.amodal');

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
