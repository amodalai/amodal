/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentBundle} from '../repo/repo-types.js';
import type {ModelConfig} from '../repo/config-schema.js';
import type {EvalRunRecord, EvalModelInfo} from './eval-types.js';
import type {EvalRunnerOptions} from './eval-runner.js';
import type {JudgeProvider} from './eval-judge.js';
import type {LLMToolDefinition} from '../providers/runtime/runtime-provider-types.js';
import {runEvalSuite} from './eval-runner.js';
import {buildEvalRun} from './eval-run-builder.js';
import {SessionEvalQueryProvider} from './eval-session-provider.js';

/**
 * Progress event for multi-model eval runs.
 */
export interface MultiModelProgress {
  type: 'model_start' | 'model_complete' | 'all_complete';
  model?: EvalModelInfo;
  currentModel?: number;
  totalModels?: number;
  passRate?: number;
  costMicros?: number;
}

/**
 * Options for multi-model eval runs.
 */
export interface MultiModelEvalOptions {
  models: ModelConfig[];
  judgeProvider: JudgeProvider;
  orgId: string;
  appId?: string;
  gitSha?: string;
  label?: string;
  triggeredBy?: 'manual' | 'ci' | 'automation';
  filter?: string;
  systemPrompt?: string;
  tools?: LLMToolDefinition[];
  maxTokens?: number;
}

/**
 * Run the same eval suite against multiple models.
 * Yields progress events and returns an EvalRunRecord per model.
 */
export async function* runMultiModelEval(
  repo: AgentBundle,
  options: MultiModelEvalOptions,
): AsyncGenerator<MultiModelProgress, EvalRunRecord[]> {
  const runs: EvalRunRecord[] = [];

  for (let i = 0; i < options.models.length; i++) {
    const modelConfig = options.models[i];
    const modelInfo: EvalModelInfo = {
      provider: modelConfig.provider,
      model: modelConfig.model,
    };

    yield {
      type: 'model_start',
      model: modelInfo,
      currentModel: i + 1,
      totalModels: options.models.length,
    };

    const queryProvider = new SessionEvalQueryProvider({
      modelConfig,
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      maxTokens: options.maxTokens,
    });

    const runnerOptions: EvalRunnerOptions = {
      queryProvider,
      judgeProvider: options.judgeProvider,
      gitSha: options.gitSha,
      filter: options.filter,
      model: modelInfo,
    };

    const gen = runEvalSuite(repo, runnerOptions);
    let suiteResult;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        suiteResult = next.value;
        break;
      }
    }

    const run = buildEvalRun(suiteResult, modelInfo, {
      orgId: options.orgId,
      appId: options.appId,
      gitSha: options.gitSha,
      label: options.label,
      triggeredBy: options.triggeredBy,
    });

    runs.push(run);

    const totalCases = suiteResult.results.length;
    yield {
      type: 'model_complete',
      model: modelInfo,
      currentModel: i + 1,
      totalModels: options.models.length,
      passRate: totalCases > 0 ? suiteResult.totalPassed / totalCases : 0,
      costMicros: run.totalCost.estimatedCostMicros,
    };
  }

  yield {type: 'all_complete'};
  return runs;
}
