/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {runEvalSuite} from './eval-runner.js';
import type {EvalQueryProvider} from './eval-runner.js';
import type {JudgeProvider} from './eval-judge.js';
import type {AgentBundle} from '../repo/repo-types.js';
import type {EvalProgress, EvalSuiteResult} from './eval-types.js';

function makeRepo(evals: AgentBundle['evals']): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: {name: 'test', version: '1.0.0', models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}}},
    connections: new Map(),
    skills: [],
    agents: {},
    automations: [],
    knowledge: [],
    evals,
    tools: [],
  };
}

function makeEval(name: string, assertions: Array<{text: string; negated: boolean}> = [{text: 'be helpful', negated: false}]) {
  return {
    name,
    title: `Test: ${name}`,
    description: 'A test eval',
    setup: {},
    query: 'What is 1+1?',
    assertions,
    raw: '',
    location: `/test/evals/${name}.md`,
  };
}

describe('runEvalSuite', () => {
  it('runs all evals and returns suite result', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'The answer is 2', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PASS: correct'),
    };

    const repo = makeRepo([makeEval('math-1'), makeEval('math-2')]);
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider});

    const progress: EvalProgress[] = [];
    let result: EvalSuiteResult | undefined;

    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      progress.push(next.value);
    }

    expect(result).toBeDefined();
    expect(result.results).toHaveLength(2);
    expect(result.totalPassed).toBe(2);
    expect(result.totalFailed).toBe(0);

    // Should have start + complete for each eval + suite_complete
    expect(progress).toHaveLength(5);
    expect(progress[0].type).toBe('eval_start');
    expect(progress[1].type).toBe('eval_complete');
  });

  it('filters evals by name', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'ok', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PASS: ok'),
    };

    const repo = makeRepo([makeEval('alpha'), makeEval('beta'), makeEval('alpha-2')]);
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider, filter: 'alpha'});

    let result: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.results).toHaveLength(2);
  });

  it('handles query errors gracefully', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn(),
    };

    const repo = makeRepo([makeEval('failing')]);
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider});

    let result: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.totalFailed).toBe(1);
    expect(result.results[0].error).toContain('connection refused');
    expect(result.results[0].assertions[0].passed).toBe(false);
  });

  it('handles mixed pass/fail assertions', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'partial answer', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn()
        .mockResolvedValueOnce('PASS: yes')
        .mockResolvedValueOnce('FAIL: no'),
    };

    const repo = makeRepo([
      makeEval('mixed', [
        {text: 'include something', negated: false},
        {text: 'be complete', negated: false},
      ]),
    ]);

    const gen = runEvalSuite(repo, {queryProvider, judgeProvider});
    let result: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].assertions[0].passed).toBe(true);
    expect(result.results[0].assertions[1].passed).toBe(false);
  });

  it('includes gitSha and timestamp in result', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'ok', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PASS: ok'),
    };

    const repo = makeRepo([makeEval('simple')]);
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider, gitSha: 'abc123'});
    let result: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.gitSha).toBe('abc123');
    expect(result.timestamp).toBeTruthy();
  });

  it('returns empty suite for empty evals', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn(),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn(),
    };

    const repo = makeRepo([]);
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider});
    let result: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result.results).toHaveLength(0);
    expect(result.totalPassed).toBe(0);
    expect(result.totalFailed).toBe(0);
  });

  it('passes app from setup to query provider', async () => {
    const queryFn = vi.fn().mockResolvedValue({response: 'ok', toolCalls: []});
    const queryProvider: EvalQueryProvider = {query: queryFn};
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PASS: ok'),
    };

    const ev = makeEval('with-app');
    ev.setup = {app: 'app-abc'};
    const repo = makeRepo([ev]);

    const gen = runEvalSuite(repo, {queryProvider, judgeProvider});
    while (true) {
      const next = await gen.next();
      if (next.done) break;
    }

    expect(queryFn).toHaveBeenCalledWith('What is 1+1?', 'app-abc');
  });
});
