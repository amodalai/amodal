/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, writeFile, mkdir} from 'node:fs/promises';
import * as path from 'node:path';
import {
  formatEvalTable,
  formatComparisonTable,
  formatEvalMarkdown,
  diffEvalResults,
} from '@amodalai/core';
import type {
  EvalSuiteResult,
  EvalQueryProvider,
  JudgeProvider,
} from '@amodalai/core';
import type {CommandModule} from 'yargs';
import {createLocalServer} from '@amodalai/runtime';
import {findRepoRoot} from '../shared/repo-discovery.js';

export interface EvalOptions {
  cwd?: string;
  filter?: string;
  save?: string;
  diff?: string;
  ci?: boolean;
  port?: number;
}

/**
 * Run eval suite against a local repo.
 */
export async function runEval(options: EvalOptions): Promise<void> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[eval] ${msg}\n`);
    process.exit(1);
  }

  const port = options.port ?? 0;
  process.stderr.write(`[eval] Loading repo from ${repoPath}\n`);

  const server = await createLocalServer({
    repoPath,
    port,
    host: '127.0.0.1',
    hotReload: false,
  });

  const httpServer = await server.start();
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  try {
    // Load repo to get evals
    const {loadRepoFromDisk} = await import('@amodalai/core');
    const repo = await loadRepoFromDisk(repoPath);

    if (repo.evals.length === 0) {
      process.stderr.write('[eval] No evals found in evals/\n');
      return;
    }

    // Create query provider that hits the local server
    const queryProvider: EvalQueryProvider = {
      query: async (message: string, appId?: string) => {
        const response = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({message, app_id: appId ?? 'eval-runner'}),
        });

        const text = await response.text();
        const lines = text.split('\n');
        let fullResponse = '';
        const toolCalls: Array<{name: string; parameters: Record<string, unknown>}> = [];
        let usage: {inputTokens: number; outputTokens: number} | undefined;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing
            const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
            if (event['type'] === 'text_delta') {
              fullResponse += String(event['content'] ?? '');
            } else if (event['type'] === 'tool_call_start') {
              toolCalls.push({
                name: String(event['tool_name'] ?? ''),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE data
                parameters: (event['parameters'] ?? {}) as Record<string, unknown>,
              });
            } else if (event['type'] === 'done') {
              // Extract usage from done event if the runtime provides it
              if (event['usage']) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                const u = event['usage'] as {input_tokens: number; output_tokens: number};
                if (u.input_tokens > 0 || u.output_tokens > 0) {
                  usage = {inputTokens: u.input_tokens, outputTokens: u.output_tokens};
                }
              }
            } else if (event['type'] === 'tool_call_result') {
              // Enrich the last matching tool call with result info
              const toolId = String(event['tool_id'] ?? '');
              const status = String(event['status'] ?? '');
              const result = String(event['result'] ?? event['error'] ?? '');
              const preview = result.length > 300 ? result.substring(0, 300) + '...' : result;
              // Add as a separate entry so the eval runner can see outcomes
              toolCalls.push({
                name: `${String(event['tool_name'] ?? 'request')}_result`,
                parameters: {tool_id: toolId, status, result: preview},
              });
            }
          } catch {
            // skip
          }
        }

        // If runtime didn't report usage, estimate from content length
        // (~4 chars per token is a reasonable approximation for English text)
        if (!usage) {
          const outputChars = fullResponse.length + toolCalls.reduce((n, tc) => n + JSON.stringify(tc.parameters).length, 0);
          const estimatedOutput = Math.ceil(outputChars / 4);
          // Input is harder to estimate — use 3x output as a rough proxy (prompt + context)
          const estimatedInput = estimatedOutput * 3;
          usage = {inputTokens: estimatedInput, outputTokens: estimatedOutput};
        }

        return {response: fullResponse, toolCalls, usage};
      },
    };

    // Simple judge — use the same server's LLM
    const judgeProvider: JudgeProvider = {
      judge: async (prompt: string) => {
        const response = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({message: prompt, app_id: 'eval-judge', session_id: `judge-${Date.now()}`}),
        });
        const text = await response.text();
        let result = '';
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing
            const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
            if (event['type'] === 'text_delta') {
              result += String(event['content'] ?? '');
            }
          } catch {
            // skip
          }
        }
        return result;
      },
    };

    // Get git SHA
    let gitSha: string | undefined;
    try {
      const {execSync} = await import('node:child_process');
      gitSha = execSync('git rev-parse HEAD', {cwd: repoPath}).toString().trim();
    } catch {
      // not a git repo
    }

    // Get model info from repo config for cost tracking
    const modelConfig = repo.config.models.main;
    const model = {provider: modelConfig.provider, model: modelConfig.model};

    const {runEvalSuite} = await import('@amodalai/core');
    const gen = runEvalSuite(repo, {queryProvider, judgeProvider, filter: options.filter, gitSha, model});

    let suiteResult: EvalSuiteResult | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        suiteResult = next.value;
        break;
      }
      const progress = next.value;
      if (progress.type === 'eval_start') {
        process.stderr.write(`[${progress.current}/${progress.total}] Running ${progress.evalName}...\n`);
      } else if (progress.type === 'eval_complete') {
        const icon = progress.passed ? 'PASS' : 'FAIL';
        process.stderr.write(`[${progress.current}/${progress.total}] ${icon} ${progress.evalName}\n`);
      }
    }

    if (!suiteResult) return;

    // Save results if --save <name>
    if (options.save) {
      const saveDir = path.join(repoPath, '.amodal', 'evals');
      await mkdir(saveDir, {recursive: true});
      const savePath = path.join(saveDir, `${options.save}.json`);
      await writeFile(savePath, JSON.stringify(suiteResult, null, 2) + '\n');
      process.stderr.write(`[eval] Saved results to ${savePath}\n`);
    }

    // Compare against saved baseline if --diff <name>
    if (options.diff) {
      const baselinePath = path.join(repoPath, '.amodal', 'evals', `${options.diff}.json`);
      let baseline: EvalSuiteResult | undefined;
      try {
        const raw = await readFile(baselinePath, 'utf-8');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        baseline = JSON.parse(raw) as EvalSuiteResult;
      } catch {
        process.stderr.write(`[eval] Baseline "${options.diff}" not found at ${baselinePath}\n`);
        process.stderr.write(`[eval] Run with --save ${options.diff} first to create it.\n`);
      }

      if (baseline) {
        const diffs = diffEvalResults(suiteResult, baseline);
        process.stdout.write(formatComparisonTable(suiteResult, baseline, diffs));
      }
    }

    // Always show the current run table
    if (options.ci) {
      process.stdout.write(formatEvalMarkdown(suiteResult, undefined, model));
    } else if (!options.diff) {
      process.stdout.write(formatEvalTable(suiteResult, model));
    }

    // Exit with non-zero if any failures
    if (suiteResult.totalFailed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await server.stop();
  }
}

export const evalCommand: CommandModule = {
  command: 'eval',
  describe: 'Run eval suite',
  builder: (yargs) =>
    yargs
      .option('filter', {type: 'string', describe: 'Filter evals by name'})
      .option('save', {type: 'string', describe: 'Save results with a name (e.g. --save baseline)'})
      .option('diff', {type: 'string', describe: 'Compare against a saved run (e.g. --diff baseline)'})
      .option('ci', {type: 'boolean', default: false, describe: 'Output in CI-friendly markdown format'})
      .option('port', {type: 'number', describe: 'Port for local eval server'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const filter = argv['filter'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const save = argv['save'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const diff = argv['diff'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ci = argv['ci'] as boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const port = argv['port'] as number | undefined;

    await runEval({filter, save, diff, ci, port});
  },
};

