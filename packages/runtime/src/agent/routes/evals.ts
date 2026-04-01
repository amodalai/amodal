/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {AgentSessionManager} from '../session-manager.js';
import type {EvalStore} from '../eval-store.js';
import {buildEvalRun, judgeAllAssertions, computeEvalCost, aggregateRunCost} from '@amodalai/core';
import type {JudgeProvider, EvalResult, EvalSuiteResult, EvalCostInfo} from '@amodalai/core';

export interface EvalRouterOptions {
  sessionManager: AgentSessionManager;
  evalStore: EvalStore;
  repoPath: string;
  /** Port the server is listening on — used by eval query provider to call /chat */
  getPort: () => number | null;
}

/**
 * Run a query against /chat and stream events back to the eval client.
 * Returns the accumulated response, tool calls, and usage.
 */
async function streamQuery(
  baseUrl: string,
  message: string,
  evalRes: Response,
  evalName: string,
  appId?: string,
): Promise<{response: string; toolCalls: Array<{name: string; parameters: Record<string, unknown>}>; toolResults: string[]; usage?: {inputTokens: number; outputTokens: number}}> {
  const chatRes = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message, app_id: appId ?? 'eval-runner'}),
  });

  const text = await chatRes.text();
  const lines = text.split('\n');
  let fullResponse = '';
  const toolCalls: Array<{name: string; parameters: Record<string, unknown>}> = [];
  const toolResults: string[] = [];
  let usage: {inputTokens: number; outputTokens: number} | undefined;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing
      const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
      const eventType = String(event['type'] ?? '');

      if (eventType === 'text_delta') {
        const content = String(event['content'] ?? '');
        fullResponse += content;
        writeSSE(evalRes, {type: 'agent_text', evalName, content});
      } else if (eventType === 'tool_call_start') {
        const params = (event['parameters'] ?? {}) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
        toolCalls.push({name: String(event['tool_name'] ?? ''), parameters: params});
        writeSSE(evalRes, {type: 'agent_tool', evalName, toolName: event['tool_name'], parameters: params});
      } else if (eventType === 'tool_call_result') {
        // Capture result data so the judge knows tool calls returned real data
        const resultPreview = String(event['result'] ?? event['error'] ?? '');
        toolResults.push(`${String(event['tool_name'] ?? 'request')}: ${resultPreview.slice(0, 500)}`);
        writeSSE(evalRes, {type: 'agent_tool_result', evalName, toolName: event['tool_name'] ?? 'request', status: event['status'], durationMs: event['duration_ms']});
      } else if (eventType === 'done' && event['usage']) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const u = event['usage'] as {input_tokens: number; output_tokens: number};
        if (u.input_tokens > 0 || u.output_tokens > 0) {
          usage = {inputTokens: u.input_tokens, outputTokens: u.output_tokens};
        }
      }
    } catch {
      // skip
    }
  }

  if (!usage) {
    const outputChars = fullResponse.length;
    const estimatedOutput = Math.ceil(outputChars / 4);
    usage = {inputTokens: estimatedOutput * 3, outputTokens: estimatedOutput};
  }

  return {response: fullResponse, toolCalls, toolResults, usage};
}

interface TrackedJudgeProvider extends JudgeProvider {
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Create a JudgeProvider that uses the local /chat endpoint and tracks token usage.
 */
function createLocalJudgeProvider(baseUrl: string): TrackedJudgeProvider {
  const tracked: TrackedJudgeProvider = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
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
          } else if (event['type'] === 'done' && event['usage']) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const u = event['usage'] as {input_tokens: number; output_tokens: number};
            tracked.totalInputTokens += u.input_tokens || 0;
            tracked.totalOutputTokens += u.output_tokens || 0;
          }
        } catch {
          // skip
        }
      }
      // Estimate if no usage reported
      if (tracked.totalInputTokens === 0) {
        tracked.totalInputTokens += Math.ceil(prompt.length / 4);
        tracked.totalOutputTokens += Math.ceil(result.length / 4);
      }
      return result;
    },
  };
  return tracked;
}

function writeSSE(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createEvalRouter(options: EvalRouterOptions): Router {
  const router = Router();

  /** List eval definitions from the repo */
  router.get('/api/evals/suites', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo();
    const suites = repo.evals.map((e) => ({
      name: e.name,
      title: e.title,
      description: e.description,
      query: e.query,
      assertionCount: e.assertions.length,
      assertions: e.assertions.map((a) => ({text: a.text, negated: a.negated})),
      location: e.location,
    }));
    res.json({suites});
  });

  /** List saved eval runs */
  router.get('/api/evals/runs', (_req: Request, res: Response) => {
    const runs = options.evalStore.list();
    res.json({runs});
  });

  /** Get a single eval run */
  router.get('/api/evals/runs/:id', (req: Request, res: Response) => {
    const run = options.evalStore.load(req.params['id'] ?? '');
    if (!run) {
      res.status(404).json({error: 'Run not found'});
      return;
    }
    res.json(run);
  });

  /** Delete an eval run */
  router.delete('/api/evals/runs/:id', (req: Request, res: Response) => {
    const deleted = options.evalStore.delete(req.params['id'] ?? '');
    if (!deleted) {
      res.status(404).json({error: 'Run not found'});
      return;
    }
    res.json({ok: true});
  });

  /** Run eval suite — SSE stream with full per-eval results */
  router.post('/api/evals/run', async (req: Request, res: Response) => {
    const port = options.getPort();
    if (!port) {
      res.status(503).json({error: 'Server not ready'});
      return;
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const repo = options.sessionManager.getRepo();
    const evals = repo.evals;

    if (evals.length === 0) {
      res.status(400).json({error: 'No evals defined'});
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const judgeProvider = createLocalJudgeProvider(baseUrl);
    const modelInfo = repo.config ? {
      provider: repo.config.models?.['main']?.provider ?? 'unknown',
      model: repo.config.models?.['main']?.model ?? 'unknown',
    } : {provider: 'unknown', model: 'unknown'};

    const results: EvalResult[] = [];
    const perCaseCosts: EvalCostInfo[] = [];
    const startTime = Date.now();

    for (let i = 0; i < evals.length; i++) {
      const ev = evals[i];
      writeSSE(res, {type: 'eval_start', evalName: ev.name, current: i + 1, total: evals.length});

      const evalStart = Date.now();
      try {
        // Run the query — streams agent events to client
        const {response, toolCalls, toolResults, usage} = await streamQuery(baseUrl, ev.query, res, ev.name, ev.setup.app);

        // Build enriched response for the judge — include tool results so it knows data was fetched
        let enriched = response;
        if (toolCalls.length > 0) {
          enriched += '\n\n[Tool calls made: ' + toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.parameters)})`).join(', ') + ']';
        }
        if (toolResults.length > 0) {
          enriched += '\n\n[Tool results received:\n' + toolResults.join('\n') + ']';
        }

        // Judge assertions — track judge tokens separately
        const judgeInputBefore = judgeProvider.totalInputTokens;
        const judgeOutputBefore = judgeProvider.totalOutputTokens;
        const assertions = await judgeAllAssertions(enriched, ev.assertions, judgeProvider);
        const passed = assertions.every((a) => a.passed);

        const queryCost = usage ? computeEvalCost(usage.inputTokens, usage.outputTokens, modelInfo.model) : undefined;
        const judgeInputUsed = judgeProvider.totalInputTokens - judgeInputBefore;
        const judgeOutputUsed = judgeProvider.totalOutputTokens - judgeOutputBefore;
        const judgeCost = judgeInputUsed > 0 ? computeEvalCost(judgeInputUsed, judgeOutputUsed, modelInfo.model) : undefined;

        if (queryCost) perCaseCosts.push(queryCost);

        const result: EvalResult = {
          eval: ev,
          response,
          toolCalls,
          assertions,
          passed,
          durationMs: Date.now() - evalStart,
          cost: queryCost,
        };
        results.push(result);

        // Send full result with eval_complete — separate query and judge costs
        writeSSE(res, {
          type: 'eval_complete',
          evalName: ev.name,
          passed,
          current: i + 1,
          total: evals.length,
          result: {
            response: response.length > 1000 ? response.slice(0, 1000) + '...' : response,
            toolCalls,
            assertions,
            durationMs: result.durationMs,
            queryCost,
            judgeCost,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const result: EvalResult = {
          eval: ev,
          response: '',
          toolCalls: [],
          assertions: [],
          passed: false,
          durationMs: Date.now() - evalStart,
          error: msg,
        };
        results.push(result);
        writeSSE(res, {
          type: 'eval_complete',
          evalName: ev.name,
          passed: false,
          current: i + 1,
          total: evals.length,
          result: {response: '', toolCalls: [], assertions: [], durationMs: result.durationMs, error: msg},
        });
      }
    }

    // Build suite result
    const totalCost = perCaseCosts.length > 0 ? aggregateRunCost(perCaseCosts) : undefined;
    const suiteResult: EvalSuiteResult = {
      results,
      totalPassed: results.filter((r) => r.passed).length,
      totalFailed: results.filter((r) => !r.passed).length,
      totalSkipped: 0,
      totalDurationMs: Date.now() - startTime,
      totalCost,
      model: modelInfo,
      timestamp: new Date().toISOString(),
    };

    const run = buildEvalRun(suiteResult, modelInfo, {orgId: 'local', triggeredBy: 'manual'});
    options.evalStore.save(run as unknown as Record<string, unknown>); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion

    writeSSE(res, {type: 'run_complete', run});
    writeSSE(res, {type: 'done'});
    res.end();
  });

  /** Get arena model config */
  router.get('/api/evals/arena/models', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo();
    const config = repo.config;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const rawConfig = config as unknown as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const arena = rawConfig['arena'] as Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const configModels = arena?.['models'] as Array<{provider: string; model: string; label?: string}> | undefined;

    const models = configModels ?? [
      {provider: 'anthropic', model: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4'},
      {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'},
      {provider: 'openai', model: 'gpt-4o', label: 'GPT-4o'},
      {provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o Mini'},
      {provider: 'google', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro'},
      {provider: 'google', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash'},
    ];

    res.json({models});
  });

  return router;
}
