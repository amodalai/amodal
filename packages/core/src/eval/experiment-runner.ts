/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalRepo} from '../repo/repo-types.js';
import type {ExperimentConfig, ExperimentEvalResult, ExperimentAssignment, ExperimentDeployment} from './experiment-types.js';
import type {EvalRunnerOptions} from './eval-runner.js';
import {runEvalSuite} from './eval-runner.js';

/**
 * Run an experiment: eval suite against both control and variant configs.
 */
export async function runExperiment(
  repo: AmodalRepo,
  config: ExperimentConfig,
  evalOptions: Omit<EvalRunnerOptions, 'gitSha'>,
): Promise<ExperimentEvalResult> {
  // Run control
  const controlGen = runEvalSuite(repo, evalOptions);
  let controlResult;
  while (true) {
    const next = await controlGen.next();
    if (next.done) {
      controlResult = next.value;
      break;
    }
  }

  // Run variant (in a real implementation, this would apply config changes)
  const variantGen = runEvalSuite(repo, evalOptions);
  let variantResult;
  while (true) {
    const next = await variantGen.next();
    if (next.done) {
      variantResult = next.value;
      break;
    }
  }

  const controlPassRate = controlResult.results.length > 0
    ? controlResult.totalPassed / controlResult.results.length
    : 0;
  const variantPassRate = variantResult.results.length > 0
    ? variantResult.totalPassed / variantResult.results.length
    : 0;

  const controlAvgDuration = controlResult.results.length > 0
    ? controlResult.results.reduce((sum, r) => sum + r.durationMs, 0) / controlResult.results.length
    : 0;
  const variantAvgDuration = variantResult.results.length > 0
    ? variantResult.results.reduce((sum, r) => sum + r.durationMs, 0) / variantResult.results.length
    : 0;

  let winner: 'control' | 'variant' | 'tie' = 'tie';
  if (variantPassRate > controlPassRate) {
    winner = 'variant';
  } else if (controlPassRate > variantPassRate) {
    winner = 'control';
  }

  return {
    experimentName: config.name,
    control: controlResult,
    variant: variantResult,
    comparison: {
      controlPassRate,
      variantPassRate,
      controlAvgDuration,
      variantAvgDuration,
      winner,
    },
  };
}

/**
 * Assign a session to control or variant based on traffic split.
 */
export function assignExperiment(
  deployment: ExperimentDeployment,
): ExperimentAssignment {
  const roll = Math.random() * 100;
  return {
    experimentId: deployment.id,
    variant: roll < deployment.trafficPercent ? 'variant' : 'control',
  };
}
