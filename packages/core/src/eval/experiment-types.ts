/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalSuiteResult} from './eval-types.js';

/**
 * A model config change to apply for the variant.
 */
export interface ExperimentChange {
  path: string;
  value: unknown;
}

/**
 * Configuration for an A/B experiment.
 */
export interface ExperimentConfig {
  name: string;
  description?: string;
  controlConfig: Record<string, unknown>;
  variantConfig: Record<string, unknown>;
  changes: ExperimentChange[];
  trafficPercent: number;
}

/**
 * Result of running an eval-based experiment.
 */
export interface ExperimentEvalResult {
  experimentName: string;
  control: EvalSuiteResult;
  variant: EvalSuiteResult;
  comparison: {
    controlPassRate: number;
    variantPassRate: number;
    controlAvgDuration: number;
    variantAvgDuration: number;
    winner: 'control' | 'variant' | 'tie';
  };
}

/**
 * A deployed experiment with traffic splitting.
 */
export interface ExperimentDeployment {
  id: string;
  name: string;
  controlConfig: Record<string, unknown>;
  variantConfig: Record<string, unknown>;
  trafficPercent: number;
}

/**
 * Assignment for a session in an active experiment.
 */
export interface ExperimentAssignment {
  experimentId: string;
  variant: 'control' | 'variant';
}
