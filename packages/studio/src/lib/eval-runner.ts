/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Eval runner — fetches an eval definition from the runtime's file tree,
 * executes each test case via POST /chat, and saves results to Postgres.
 */

import { saveEvalRun } from './eval-queries';
import { parseEvalMarkdown } from './eval-parser';
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

interface EvalCaseResult {
  input: string;
  output: string;
  passed: boolean;
  durationMs: number;
}

interface FileContentResponse {
  path: string;
  content: string;
  language: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CASE_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run an eval suite: fetch the eval definition from the runtime,
 * send each test case to the runtime's /chat endpoint,
 * record pass/fail, and persist the run to Postgres.
 *
 * @param evalName — the eval file name (without .md extension)
 * @param runtimeUrl — the runtime URL to fetch the eval from and run against
 * @param agentId — the agent ID to scope the run to
 * @returns the new run ID
 */
export async function runEvalSuite(evalName: string, runtimeUrl: string, agentId: string): Promise<string> {

  // Fetch the eval file from the runtime
  const filePath = `evals/${evalName}.md`;
  let fileContent: string;
  try {
    const res = await fetch(`${runtimeUrl}/api/files/${encodeURIComponent(filePath)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new EvalRunnerError(`Eval file not found: ${filePath}`, { suiteId: evalName });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
    const data = (await res.json()) as FileContentResponse;
    fileContent = data.content;
  } catch (err: unknown) {
    if (err instanceof EvalRunnerError) throw err;
    throw new EvalRunnerError(`Failed to fetch eval file: ${filePath}`, { suiteId: evalName, cause: err });
  }

  const parsed = parseEvalMarkdown(fileContent, `${evalName}.md`);

  if (!parsed.query) {
    throw new EvalRunnerError(`Eval ${evalName} has no query defined`, { suiteId: evalName });
  }

  const suiteId = `${agentId}:${evalName}`;
  const cases = [{ input: parsed.query, expected: undefined as string | undefined }];
  const results: EvalCaseResult[] = [];
  const startTime = Date.now();

  logger.info('eval_run_started', { suiteId, agentId, caseCount: cases.length });

  for (const testCase of cases) {
    const caseStart = Date.now();
    try {
      const res = await fetch(`${runtimeUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testCase.input }),
        signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
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
