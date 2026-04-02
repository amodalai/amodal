/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentBundle} from '../repo/repo-types.js';
import type {LoadedEval} from '../repo/repo-types.js';
import type {EvalResult, EvalSuiteResult, EvalProgress, EvalCostInfo, EvalModelInfo} from './eval-types.js';
import type {JudgeProvider} from './eval-judge.js';
import {judgeAllAssertions} from './eval-judge.js';
import {computeEvalCost, aggregateRunCost} from './eval-cost.js';

/**
 * Provider interface for running a query against the agent.
 */
export interface EvalQueryProvider {
  query(message: string, appId?: string): Promise<{
    response: string;
    toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
    usage?: {inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number};
  }>;
}

export interface EvalRunnerOptions {
  filter?: string;
  queryProvider: EvalQueryProvider;
  judgeProvider: JudgeProvider;
  gitSha?: string;
  model?: EvalModelInfo;
}

/**
 * Run the eval suite from a loaded repo.
 * Yields progress events and returns the full suite result.
 */
export async function* runEvalSuite(
  repo: AgentBundle,
  options: EvalRunnerOptions,
): AsyncGenerator<EvalProgress, EvalSuiteResult> {
  const startTime = Date.now();
  let evals = repo.evals;

  if (options.filter) {
    const pattern = options.filter.toLowerCase();
    evals = evals.filter(
      (e) => e.name.toLowerCase().includes(pattern) || e.title.toLowerCase().includes(pattern),
    );
  }

  const results: EvalResult[] = [];
  const perCaseCosts: EvalCostInfo[] = [];

  for (let i = 0; i < evals.length; i++) {
    const ev = evals[i];
    yield {type: 'eval_start', evalName: ev.name, current: i + 1, total: evals.length};

    const result = await runSingleEval(ev, options);
    results.push(result);
    if (result.cost) {
      perCaseCosts.push(result.cost);
    }

    yield {type: 'eval_complete', evalName: ev.name, passed: result.passed, current: i + 1, total: evals.length};
  }

  const totalCost = perCaseCosts.length > 0 ? aggregateRunCost(perCaseCosts) : undefined;

  const suiteResult: EvalSuiteResult = {
    results,
    totalPassed: results.filter((r) => r.passed).length,
    totalFailed: results.filter((r) => !r.passed).length,
    totalSkipped: 0,
    totalDurationMs: Date.now() - startTime,
    totalCost,
    model: options.model,
    gitSha: options.gitSha,
    timestamp: new Date().toISOString(),
  };

  yield {type: 'suite_complete'};
  return suiteResult;
}

async function runSingleEval(
  ev: LoadedEval,
  options: EvalRunnerOptions,
): Promise<EvalResult> {
  const start = Date.now();

  try {
    const {response, toolCalls, usage} = await options.queryProvider.query(
      ev.query,
      ev.setup.app,
    );

    // Build enriched response that includes tool call info for the judge.
    // The judge only sees text, so we append a structured summary of
    // tool calls so assertions about tool usage can be evaluated.
    let enrichedResponse = response;
    if (toolCalls.length > 0) {
      const toolSummary = toolCalls
        .map((tc) => `- ${tc.name}(${JSON.stringify(tc.parameters)})`)
        .join('\n');
      enrichedResponse += `\n\n## Tool Calls Made\n${toolSummary}`;
    }

    const assertions = await judgeAllAssertions(
      enrichedResponse,
      ev.assertions,
      options.judgeProvider,
    );

    const passed = assertions.every((a) => a.passed);

    const cost = usage && options.model
      ? computeEvalCost(
          usage.inputTokens, usage.outputTokens, options.model.model,
          usage.cacheReadInputTokens, usage.cacheCreationInputTokens,
        )
      : undefined;

    return {
      eval: ev,
      response,
      toolCalls,
      assertions,
      passed,
      durationMs: Date.now() - start,
      cost,
    };
  } catch (err) {
    return {
      eval: ev,
      response: '',
      toolCalls: [],
      assertions: ev.assertions.map((a) => ({
        text: a.text,
        negated: a.negated,
        passed: false,
        reason: `Eval execution error: ${err instanceof Error ? err.message : String(err)}`,
      })),
      passed: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
