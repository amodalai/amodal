/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

vi.mock('@amodalai/runtime', () => ({
  createLocalServer: vi.fn().mockResolvedValue({
    start: vi.fn().mockResolvedValue({address: () => ({port: 9999})}),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: vi.fn(() => '/test/repo'),
}));

const mockLoadRepo = vi.fn();
const mockRunEvalSuite = vi.fn();
vi.mock('@amodalai/core', async () => {
  const actual = await vi.importActual('@amodalai/core');
  return {
    ...actual,
    loadRepoFromDisk: mockLoadRepo,
    runEvalSuite: mockRunEvalSuite,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Mock fetch for SSE responses
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue('data: {"type":"text_delta","content":"test response"}\n'),
  }));
});

describe('runEval', () => {
  it('exits early when no evals found', async () => {
    mockLoadRepo.mockResolvedValue({
      evals: [],
      config: {name: 'test', models: {main: {provider: 'anthropic', model: 'test'}}},
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const {runEval} = await import('./eval.js');

    await runEval({cwd: '/test'});
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No evals found'));

    stderrSpy.mockRestore();
  });

  it('runs eval suite and outputs table', async () => {
    mockLoadRepo.mockResolvedValue({
      evals: [{name: 'test-1', title: 'Test', description: '', setup: {}, query: 'hi', assertions: [{text: 'work', negated: false}], raw: '', location: '/test'}],
      config: {name: 'test', models: {main: {provider: 'anthropic', model: 'test'}}},
    });

    // Mock the generator
    async function* mockGen() {
      yield {type: 'eval_start' as const, evalName: 'test-1', current: 1, total: 1};
      yield {type: 'eval_complete' as const, evalName: 'test-1', passed: true, current: 1, total: 1};
      yield {type: 'suite_complete' as const};
      return {
        results: [{eval: {name: 'test-1'}, passed: true, assertions: [{passed: true, text: 'work', negated: false, reason: 'ok'}], response: 'ok', toolCalls: [], durationMs: 100}],
        totalPassed: 1,
        totalFailed: 0,
        totalSkipped: 0,
        totalDurationMs: 100,
        timestamp: new Date().toISOString(),
      };
    }
    mockRunEvalSuite.mockReturnValue(mockGen());

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const {runEval} = await import('./eval.js');
    await runEval({cwd: '/test'});

    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
