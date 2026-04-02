/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {runMultiModelEval} from './multi-model-runner.js';
import type {MultiModelProgress} from './multi-model-runner.js';
import type {AgentBundle} from '../repo/repo-types.js';
import type {EvalRunRecord} from './eval-types.js';

vi.mock('../providers/runtime/provider-factory.js', () => ({
  createRuntimeProvider: vi.fn(() => ({
    chat: vi.fn().mockResolvedValue({
      content: [{type: 'text', text: 'The answer is 2'}],
      stopReason: 'end_turn',
      usage: {inputTokens: 100, outputTokens: 50},
    }),
  })),
}));

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

function makeEval(name: string) {
  return {
    name,
    title: `Test: ${name}`,
    description: 'A test eval',
    setup: {},
    query: 'What is 1+1?',
    assertions: [{text: 'be correct', negated: false}],
    raw: '',
    location: `/test/evals/${name}.md`,
  };
}

describe('runMultiModelEval', () => {
  it('runs evals against multiple models and returns records', async () => {
    const repo = makeRepo([makeEval('math-1')]);
    const judgeProvider = {judge: vi.fn().mockResolvedValue('PASS: correct')};

    const gen = runMultiModelEval(repo, {
      models: [
        {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
        {provider: 'openai', model: 'gpt-4o'},
      ],
      judgeProvider,
      orgId: 'org-1',
      gitSha: 'abc123',
      label: 'test-run',
    });

    const progress: MultiModelProgress[] = [];
    let result: EvalRunRecord[] | undefined;

    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      progress.push(next.value);
    }

    // Should have: model_start, model_complete for each model + all_complete
    expect(progress).toHaveLength(5);
    expect(progress[0].type).toBe('model_start');
    expect(progress[0].model?.provider).toBe('anthropic');
    expect(progress[1].type).toBe('model_complete');
    expect(progress[1].passRate).toBe(1);
    expect(progress[2].type).toBe('model_start');
    expect(progress[2].model?.provider).toBe('openai');
    expect(progress[4].type).toBe('all_complete');

    expect(result).toHaveLength(2);
    expect(result[0].model.provider).toBe('anthropic');
    expect(result[1].model.provider).toBe('openai');
    expect(result[0].orgId).toBe('org-1');
    expect(result[0].gitSha).toBe('abc123');
    expect(result[0].label).toBe('test-run');
  });

  it('handles single model', async () => {
    const repo = makeRepo([makeEval('test-1')]);
    const judgeProvider = {judge: vi.fn().mockResolvedValue('PASS: ok')};

    const gen = runMultiModelEval(repo, {
      models: [{provider: 'google', model: 'gemini-2.5-flash'}],
      judgeProvider,
      orgId: 'org-1',
    });

    let result: EvalRunRecord[] | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result).toHaveLength(1);
    expect(result[0].model.model).toBe('gemini-2.5-flash');
  });

  it('captures cost info from provider usage', async () => {
    const repo = makeRepo([makeEval('cost-test')]);
    const judgeProvider = {judge: vi.fn().mockResolvedValue('PASS: ok')};

    const gen = runMultiModelEval(repo, {
      models: [{provider: 'anthropic', model: 'claude-sonnet-4-20250514'}],
      judgeProvider,
      orgId: 'org-1',
    });

    let result: EvalRunRecord[] | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result[0].totalCost.inputTokens).toBe(100);
    expect(result[0].totalCost.outputTokens).toBe(50);
    expect(result[0].totalCost.estimatedCostMicros).toBeGreaterThan(0);
  });
});
