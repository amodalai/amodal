/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {SessionManager} from '../../session/session-manager.js';
import type {EvalStore} from '../eval-store.js';
import {buildEvalRun, judgeAllAssertions, computeEvalCost, aggregateRunCost, createRuntimeProvider} from '@amodalai/core';
import type {JudgeProvider, EvalResult, EvalSuiteResult, EvalCostInfo, ModelConfig} from '@amodalai/core';

/**
 * Summarize a JSON tool result for the judge.
 * Keeps structure intact but truncates long string values and summarizes arrays.
 * The judge needs to verify data accuracy, not read every byte.
 */
function summarizeForJudge(raw: string, maxStringLen = 120, maxArrayItems = 5): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(summarizeValue(parsed, maxStringLen, maxArrayItems), null, 0);
  } catch {
    // Not JSON — truncate as string
    return raw.length > 2000 ? raw.slice(0, 2000) + '...' : raw;
  }
}

function summarizeValue(val: unknown, maxStr: number, maxArr: number): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.length > maxStr ? val.slice(0, maxStr) + '...' : val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    const shown = val.slice(0, maxArr).map((v) => summarizeValue(v, maxStr, maxArr));
    if (val.length > maxArr) {
      return [...shown, `(+${val.length - maxArr} more items, ${val.length} total)`];
    }
    return shown;
  }
  if (typeof val === 'object') {
    const result: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- recursive JSON summarization
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = summarizeValue(v, maxStr, maxArr);
    }
    return result;
  }
  return val;
}

export interface EvalRouterOptions {
  sessionManager: SessionManager;
  evalStore: EvalStore;
  repoPath: string;
  /** Port the server is listening on — used by eval query provider to call /chat */
  getPort: () => number | null;
}

/**
 * Run a query against /chat and stream events back to the eval client.
 * Returns the accumulated response, tool calls, and usage.
 */
interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

async function streamQuery(
  baseUrl: string,
  message: string,
  evalRes: Response,
  evalName: string,
  appId?: string,
  sessionId?: string,
): Promise<{response: string; toolCalls: Array<{name: string; parameters: Record<string, unknown>}>; toolResults: string[]; usage?: QueryUsage; error?: string}> {
  const chatRes = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message, app_id: appId ?? 'eval-runner', ...(sessionId ? {session_id: sessionId} : {})}),
  });

  const text = await chatRes.text();
  const lines = text.split('\n');
  let fullResponse = '';
  const toolCalls: Array<{name: string; parameters: Record<string, unknown>}> = [];
  const toolResults: string[] = [];
  let usage: QueryUsage | undefined;
  let queryError: string | undefined;

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
        // Summarize tool results for the judge — keeps JSON structure but truncates
        // long string values and caps arrays. Same summary shown in the UI.
        const resultRaw = String(event['result'] ?? event['error'] ?? '');
        toolResults.push(`${String(event['tool_name'] ?? 'request')}: ${summarizeForJudge(resultRaw)}`);
        writeSSE(evalRes, {type: 'agent_tool_result', evalName, toolName: event['tool_name'] ?? 'request', status: event['status'], durationMs: event['duration_ms']});
      } else if (eventType === 'error') {
        queryError = String(event['message'] ?? event['error'] ?? 'Unknown error');
        writeSSE(evalRes, {type: 'agent_error', evalName, error: queryError});
      } else if (eventType === 'done') {
         
        const u = (event['usage'] ?? {}) as {input_tokens?: number; output_tokens?: number; cached_tokens?: number; cache_creation_tokens?: number};
        // Accumulate tokens across multiple done events (multi-turn agent loops
        // may emit one done per turn in the session runner)
        if ((u.input_tokens ?? 0) > 0 || (u.output_tokens ?? 0) > 0 || (u.cached_tokens ?? 0) > 0) {
          if (!usage) {
            usage = {inputTokens: 0, outputTokens: 0};
          }
          usage.inputTokens += u.input_tokens ?? 0;
          usage.outputTokens += u.output_tokens ?? 0;
          if (u.cached_tokens) {
            usage.cacheReadInputTokens = (usage.cacheReadInputTokens ?? 0) + u.cached_tokens;
          }
          if (u.cache_creation_tokens) {
            usage.cacheCreationInputTokens = (usage.cacheCreationInputTokens ?? 0) + u.cache_creation_tokens;
          }
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

  return {response: fullResponse, toolCalls, toolResults, usage, ...(queryError ? {error: queryError} : {})};
}

interface TrackedJudgeProvider extends JudgeProvider {
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Create a JudgeProvider that calls the LLM directly — no session, no tools,
 * no system prompt overhead. Just a simple prompt→response for each assertion.
 * This is ~10x cheaper than routing through /chat with the full agent context.
 */
function createDirectJudgeProvider(modelConfig: ModelConfig): TrackedJudgeProvider {
  const provider = createRuntimeProvider(modelConfig);
  const tracked: TrackedJudgeProvider = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    judge: async (prompt: string) => {
      try {
        const response = await provider.chat({
          model: modelConfig.model,
          systemPrompt: 'You are an eval judge. Be concise.',
          messages: [{role: 'user', content: prompt}],
          tools: [],
          maxTokens: 256,
        });

        const text = response.content
          .filter((b): b is {type: 'text'; text: string} => b.type === 'text')
          .map((b) => b.text)
          .join('');

        if (response.usage) {
          tracked.totalInputTokens += response.usage.inputTokens + (response.usage.cacheReadInputTokens ?? 0) + (response.usage.cacheCreationInputTokens ?? 0);
          tracked.totalOutputTokens += response.usage.outputTokens;
        }

        return text;
      } catch (err) {
        return `Judge error: ${err instanceof Error ? err.message : String(err)}`;
      }
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
    const repo = options.sessionManager.getRepo()!;
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
    const repo = options.sessionManager.getRepo()!;

    // Read optional eval names and model override from POST body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    const body = (req.body ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    const evalNames = body['evalNames'] as string[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- request body
    const modelOverride = body['model'] as {provider: string; model: string} | undefined;

    let evals = repo.evals;
    if (evalNames && evalNames.length > 0) {
      evals = evals.filter((e) => evalNames.includes(e.name));
    }

    if (evals.length === 0) {
      res.status(400).json({error: 'No evals defined'});
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Save original model config for restoration after override
    const originalModelConfig = repo.config?.models?.['main'];

    // If model override provided, swap main model config
    if (modelOverride && repo.config?.models) {
      repo.config.models['main'] = {
        provider: modelOverride.provider,
        model: modelOverride.model,
      };
    }

    const evalSessionId = `eval-${Date.now()}`;

    const judgeProvider = createDirectJudgeProvider(originalModelConfig);
    const modelInfo = repo.config ? {
      provider: repo.config.models?.['main']?.provider ?? 'unknown',
      model: repo.config.models?.['main']?.model ?? 'unknown',
    } : {provider: 'unknown', model: 'unknown'};

    const results: EvalResult[] = [];
    const perCaseCosts: EvalCostInfo[] = [];
    const startTime = Date.now();

    // Restore original model before judging so judge uses the original model
    const restoreModel = () => {
      if (originalModelConfig && repo.config?.models) {
        repo.config.models['main'] = originalModelConfig;
      }
    };

    for (let i = 0; i < evals.length; i++) {
      const ev = evals[i];
      writeSSE(res, {type: 'eval_start', evalName: ev.name, current: i + 1, total: evals.length});

      const evalStart = Date.now();
      try {
        // Run the query — streams agent events to client
        const {response, toolCalls, toolResults, usage, error: queryError} = await streamQuery(baseUrl, ev.query, res, ev.name, ev.setup.app, evalSessionId);

        // Restore original model for judging
        restoreModel();

        let assertions: Array<import('@amodalai/core').AssertionResult> = [];
        let passed = false;
        let judgeCost: EvalCostInfo | undefined;

        // Skip judging if query had an error
        if (!queryError) {
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
          assertions = await judgeAllAssertions(enriched, ev.assertions, judgeProvider);
          passed = assertions.every((a) => a.passed);

          const judgeInputUsed = judgeProvider.totalInputTokens - judgeInputBefore;
          const judgeOutputUsed = judgeProvider.totalOutputTokens - judgeOutputBefore;
          judgeCost = judgeInputUsed > 0 ? computeEvalCost(judgeInputUsed, judgeOutputUsed, originalModelConfig?.model ?? modelInfo.model) : undefined;
        }

        // Re-apply model override for next eval query
        if (modelOverride && repo.config?.models) {
          repo.config.models['main'] = {
            provider: modelOverride.provider,
            model: modelOverride.model,
          };
        }

        const queryCost = usage ? computeEvalCost(
          usage.inputTokens, usage.outputTokens, modelInfo.model,
          usage.cacheReadInputTokens, usage.cacheCreationInputTokens,
        ) : undefined;

        if (queryCost) perCaseCosts.push(queryCost);

        const result: EvalResult = {
          eval: ev,
          response,
          toolCalls,
          assertions,
          passed,
          durationMs: Date.now() - evalStart,
          cost: queryCost,
          ...(queryError ? {error: queryError} : {}),
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
            response: response.length > 4000 ? response.slice(0, 4000) + '...' : response,
            toolCalls,
            toolResults,
            assertions,
            durationMs: result.durationMs,
            queryCost,
            judgeCost,
            ...(queryError ? {error: queryError} : {}),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Restore original model on error too
        restoreModel();
        if (modelOverride && repo.config?.models) {
          repo.config.models['main'] = {
            provider: modelOverride.provider,
            model: modelOverride.model,
          };
        }
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

    // Restore original model config
    restoreModel();

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

    // Suppress unused variable warnings
    void evalSessionId;

    writeSSE(res, {type: 'run_complete', run});
    writeSSE(res, {type: 'done'});
    res.end();
  });

  /** Get eval history for a specific eval */
  router.get('/api/evals/runs/by-eval/:evalName', (req: Request, res: Response) => {
    const evalName = req.params['evalName'] ?? '';
    const entries = options.evalStore.listByEval(evalName);
    res.json({entries});
  });

  /** Get arena model config */
  router.get('/api/evals/arena/models', (_req: Request, res: Response) => {
    const repo = options.sessionManager.getRepo()!;
    const config = repo.config;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const rawConfig = config as unknown as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const arena = rawConfig['arena'] as Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config shape
    const configModels = arena?.['models'] as Array<{provider: string; model: string; label?: string}> | undefined;

    const models = configModels ?? [
      {provider: 'anthropic', model: 'claude-opus-4-6', label: 'Claude Opus 4.6'},
      {provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6'},
      {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'},
      {provider: 'openai', model: 'gpt-4o', label: 'GPT-4o'},
      {provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o Mini'},
      {provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1'},
      {provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 Mini'},
      {provider: 'google', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro'},
      {provider: 'google', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash'},
      {provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Chat'},
      {provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek Reasoner'},
      {provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)'},
      {provider: 'groq', model: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Groq)'},
      {provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (Groq)'},
      {provider: 'groq', model: 'qwen/qwen3-32b', label: 'Qwen 3 32B (Groq)'},
      {provider: 'groq', model: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 (Groq)'},
      {provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)'},
    ];

    res.json({models});
  });

  return router;
}
