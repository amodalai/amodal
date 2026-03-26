/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {EvalBaseline, EvalSuiteResult, EvalTrendPoint} from './eval-types.js';

/**
 * Summary of an eval run (without full suite result JSONB).
 */
export interface EvalRunSummary {
  id: string;
  modelProvider: string;
  modelName: string;
  gitSha: string | null;
  label: string | null;
  triggeredBy: string;
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  estimatedCostMicros: number;
  createdAt: string;
}

/**
 * Comparison result from the platform API.
 */
export interface PlatformEvalComparison {
  runA: Record<string, unknown>;
  runB: Record<string, unknown>;
  costDelta: { totalMicros: number };
  qualityDelta: { passRateDelta: number; durationDeltaMs: number };
}

/**
 * Client for platform eval baseline and run storage.
 */
export class PlatformEvalClient {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(platformUrl: string, apiKey: string) {
    this.url = platformUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  // -------------------------------------------------------------------------
  // Baselines
  // -------------------------------------------------------------------------

  /**
   * Get the latest production baseline.
   */
  async getProductionBaseline(): Promise<EvalBaseline | null> {
    const response = await fetch(`${this.url}/api/evals/baselines/production`, {
      headers: this.headers,
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to fetch baseline: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    return await response.json() as EvalBaseline;
  }

  /**
   * Upload a new baseline.
   */
  async uploadBaseline(
    result: EvalSuiteResult,
    gitSha: string,
    isProduction: boolean,
  ): Promise<void> {
    const response = await fetch(`${this.url}/api/evals/baselines`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({result, gitSha, isProduction}),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload baseline: ${response.status}`);
    }
  }

  // -------------------------------------------------------------------------
  // Eval Runs
  // -------------------------------------------------------------------------

  /**
   * Create a new eval run.
   */
  async createRun(data: {
    orgId?: string;
    appId?: string;
    modelProvider: string;
    modelName: string;
    gitSha?: string;
    label?: string;
    triggeredBy?: string;
    passRate: number;
    totalPassed: number;
    totalFailed: number;
    totalDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
    suiteResult: Record<string, unknown>;
    perCaseCosts: Array<Record<string, unknown>>;
  }): Promise<string> {
    const response = await fetch(`${this.url}/api/evals/runs`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create eval run: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    const body = await response.json() as {id: string};
    return body.id;
  }

  /**
   * List eval runs for an org.
   */
  async listRuns(options?: {
    orgId?: string;
    model?: string;
    label?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<EvalRunSummary[]> {
    const params = new URLSearchParams();
    if (options?.orgId) params.set('orgId', options.orgId);
    if (options?.model) params.set('model', options.model);
    if (options?.label) params.set('label', options.label);
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${this.url}/api/evals/runs${qs}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to list eval runs: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    const body = await response.json() as {runs: EvalRunSummary[]};
    return body.runs;
  }

  /**
   * Get a single eval run by ID.
   */
  async getRun(id: string): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${this.url}/api/evals/runs/${encodeURIComponent(id)}`, {
      headers: this.headers,
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to get eval run: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    return await response.json() as Record<string, unknown>;
  }

  /**
   * Compare two eval runs.
   */
  async compareRuns(runAId: string, runBId: string): Promise<PlatformEvalComparison> {
    const response = await fetch(
      `${this.url}/api/evals/runs/compare?runA=${encodeURIComponent(runAId)}&runB=${encodeURIComponent(runBId)}`,
      {headers: this.headers},
    );

    if (!response.ok) {
      throw new Error(`Failed to compare eval runs: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    return await response.json() as PlatformEvalComparison;
  }

  /**
   * Get eval trend data for charting.
   */
  async getTrends(options?: {
    orgId?: string;
    model?: string;
    limit?: number;
    from?: string;
    to?: string;
  }): Promise<EvalTrendPoint[]> {
    const params = new URLSearchParams();
    if (options?.orgId) params.set('orgId', options.orgId);
    if (options?.model) params.set('model', options.model);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);

    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${this.url}/api/evals/trends${qs}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to get eval trends: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
    const body = await response.json() as {trends: EvalTrendPoint[]};
    return body.trends;
  }
}
