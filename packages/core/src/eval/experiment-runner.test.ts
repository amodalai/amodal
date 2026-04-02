/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {runExperiment, assignExperiment} from './experiment-runner.js';
import type {ExperimentConfig} from './experiment-types.js';
import type {EvalQueryProvider} from './eval-runner.js';
import type {JudgeProvider} from './eval-judge.js';
import type {AgentBundle} from '../repo/repo-types.js';

function makeRepo(): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: {name: 'test', version: '1.0.0', models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}}},
    connections: new Map(),
    skills: [],
    agents: {},
    automations: [],
    knowledge: [],
    evals: [
      {name: 'eval-1', title: 'Test', description: '', setup: {}, query: 'hi', assertions: [{text: 'work', negated: false}], raw: '', location: '/test'},
      {name: 'eval-2', title: 'Test 2', description: '', setup: {}, query: 'hello', assertions: [{text: 'respond', negated: false}], raw: '', location: '/test'},
    ],
    tools: [],
  };
}

describe('runExperiment', () => {
  it('runs eval suite for both control and variant', async () => {
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'ok', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PASS: ok'),
    };
    const config: ExperimentConfig = {
      name: 'test-experiment',
      controlConfig: {model: 'claude-sonnet-4-20250514'},
      variantConfig: {model: 'gpt-4o'},
      changes: [],
      trafficPercent: 50,
    };

    const result = await runExperiment(makeRepo(), config, {queryProvider, judgeProvider});

    expect(result.experimentName).toBe('test-experiment');
    expect(result.control.totalPassed).toBe(2);
    expect(result.variant.totalPassed).toBe(2);
    expect(result.comparison.winner).toBe('tie');
    expect(result.comparison.controlPassRate).toBe(1);
    expect(result.comparison.variantPassRate).toBe(1);
  });

  it('identifies winner when pass rates differ', async () => {
    let callCount = 0;
    const queryProvider: EvalQueryProvider = {
      query: vi.fn().mockResolvedValue({response: 'ok', toolCalls: []}),
    };
    const judgeProvider: JudgeProvider = {
      judge: vi.fn().mockImplementation(() => {
        callCount++;
        // First 2 calls (control evals) pass, 3rd call (first variant eval) fails, 4th passes
        return Promise.resolve(callCount === 3 ? 'FAIL: nope' : 'PASS: ok');
      }),
    };

    const config: ExperimentConfig = {
      name: 'test-exp',
      controlConfig: {},
      variantConfig: {},
      changes: [],
      trafficPercent: 50,
    };

    const result = await runExperiment(makeRepo(), config, {queryProvider, judgeProvider});

    expect(result.comparison.controlPassRate).toBe(1);
    expect(result.comparison.variantPassRate).toBe(0.5);
    expect(result.comparison.winner).toBe('control');
  });
});

describe('assignExperiment', () => {
  it('assigns to control or variant based on traffic split', () => {
    const deployment = {
      id: 'exp-1',
      name: 'test',
      controlConfig: {},
      variantConfig: {},
      trafficPercent: 50,
    };

    // Run many times to verify both outcomes are possible
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const assignment = assignExperiment(deployment);
      expect(assignment.experimentId).toBe('exp-1');
      results.add(assignment.variant);
    }
    expect(results.has('control')).toBe(true);
    expect(results.has('variant')).toBe(true);
  });

  it('assigns all to variant at 100%', () => {
    const deployment = {
      id: 'exp-1',
      name: 'test',
      controlConfig: {},
      variantConfig: {},
      trafficPercent: 100,
    };

    for (let i = 0; i < 20; i++) {
      expect(assignExperiment(deployment).variant).toBe('variant');
    }
  });

  it('assigns all to control at 0%', () => {
    const deployment = {
      id: 'exp-1',
      name: 'test',
      controlConfig: {},
      variantConfig: {},
      trafficPercent: 0,
    };

    for (let i = 0; i < 20; i++) {
      expect(assignExperiment(deployment).variant).toBe('control');
    }
  });
});
