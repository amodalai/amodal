/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Eval runner — executes an eval suite by calling the runtime's
 * POST /chat for each test case and saves the results.
 */

import { getRuntimeUrl } from './runtime-client';
import { saveEvalRun, getEvalSuite } from './eval-queries';
import { logger } from './logger';
import { StudioError } from './errors';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class EvalRunnerError extends StudioError {
  constructor(
    message: string,
    options: {
      suiteId: string;
      cause?: unknown;
    },
  ) {
    super('EVAL_RUNNER_ERROR', message, 500, { suiteId: options.suiteId }, options.cause);
    this.name = 'EvalRunnerError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalCase {
  input: string;
  expected?: string;
}

interface EvalSuiteConfig {
  cases: EvalCase[];
}

interface EvalCaseResult {
  input: string;
  output: string;
  passed: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CASE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run an eval suite: send each test case to the runtime's /chat endpoint,
 * record pass/fail based on expected substring match, and persist the run.
 *
 * Returns the new run ID.
 */
export async function runEvalSuite(suiteId: string, agentId: string): Promise<string> {
  const suite = await getEvalSuite(suiteId);
  if (!suite) {
    throw new EvalRunnerError(`Eval suite ${suiteId} not found`, { suiteId });
  }

  const runtimeUrl = getRuntimeUrl();
  // System boundary cast — suite.config is stored as jsonb
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const config = suite.config as unknown as EvalSuiteConfig;
  const results: EvalCaseResult[] = [];

  const startTime = Date.now();

  logger.info('eval_run_started', { suiteId, agentId, caseCount: config.cases.length });

  for (const testCase of config.cases) {
    const caseStart = Date.now();
    try {
      const res = await fetch(`${runtimeUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testCase.input }),
        signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
      });

      // System boundary cast — response shape from runtime API
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const data = (await res.json()) as { response?: string };
      const output = data.response ?? '';
      const passed = testCase.expected ? output.includes(testCase.expected) : true;
      results.push({ input: testCase.input, output, passed, durationMs: Date.now() - caseStart });
    } catch (err: unknown) {
      logger.warn('eval_case_error', {
        suiteId,
        input: testCase.input,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({
        input: testCase.input,
        output: err instanceof Error ? err.message : String(err),
        passed: false,
        durationMs: Date.now() - caseStart,
      });
    }
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const runId = crypto.randomUUID();
  const durationMs = Date.now() - startTime;

  await saveEvalRun({
    id: runId,
    agentId,
    suiteId,
    model: {},
    results,
    passRate: results.length > 0 ? totalPassed / results.length : 0,
    totalPassed,
    totalFailed: results.length - totalPassed,
    durationMs,
    triggeredBy: 'manual',
  });

  logger.info('eval_run_completed', {
    suiteId,
    runId,
    totalPassed,
    totalFailed: results.length - totalPassed,
    durationMs,
  });

  return runId;
}
