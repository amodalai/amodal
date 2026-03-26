/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

describe('runExperimentCommand', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('lists experiments', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        experiments: [
          {id: 'exp-1', name: 'test-exp', status: 'draft'},
        ],
      }),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runExperimentCommand} = await import('./experiment.js');
    await runExperimentCommand({
      action: 'list',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('exp-1');
    expect(output).toContain('test-exp');
    stdoutSpy.mockRestore();
  });

  it('creates an experiment', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({id: 'exp-new'}),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runExperimentCommand} = await import('./experiment.js');
    await runExperimentCommand({
      action: 'create',
      name: 'my-experiment',
      controlConfig: '{"model":"claude-sonnet-4-20250514"}',
      variantConfig: '{"model":"gpt-4o"}',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('Created experiment: exp-new');
    stdoutSpy.mockRestore();
  });

  it('deploys an experiment', async () => {
    fetchSpy.mockResolvedValue({ok: true, json: () => Promise.resolve({status: 'ok'})});

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runExperimentCommand} = await import('./experiment.js');
    await runExperimentCommand({
      action: 'deploy',
      id: 'exp-1',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('Deployed experiment: exp-1');
    stdoutSpy.mockRestore();
  });

  it('watches an experiment', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({id: 'exp-1', name: 'test', status: 'deployed'}),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runExperimentCommand} = await import('./experiment.js');
    await runExperimentCommand({
      action: 'watch',
      id: 'exp-1',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('"id": "exp-1"');
    stdoutSpy.mockRestore();
  });

  it('handles empty experiment list', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({experiments: []}),
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const {runExperimentCommand} = await import('./experiment.js');
    await runExperimentCommand({
      action: 'list',
      platformUrl: 'http://localhost:4000',
      platformApiKey: 'key-123',
    });

    const output = stdoutSpy.mock.calls.map(([s]) => s).join('');
    expect(output).toContain('No experiments found');
    stdoutSpy.mockRestore();
  });
});
