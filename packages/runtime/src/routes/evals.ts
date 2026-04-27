/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Eval execution route.
 *
 * Accepts POST to /api/evals/run, runs the specified evals from the
 * agent bundle against the runtime's own chat endpoint, judges the
 * results with an LLM, and streams SSE progress events back to the
 * caller (typically the Studio ArenaPage).
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {AgentBundle} from '@amodalai/types';
import {judgeAllAssertions, computeEvalCost} from '@amodalai/core';
import type {JudgeProvider, EvalCostInfo} from '@amodalai/core';
import {asyncHandler} from './route-helpers.js';
import {log} from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalRouterOptions {
  /** Returns the current agent bundle (may be hot-reloaded). */
  getBundle: () => AgentBundle;
}

interface EvalRunBody {
  evalNames: string[];
  model?: {provider: string; model: string};
}

interface EvalResultEvent {
  type: 'eval_complete';
  evalName: string;
  passed: boolean;
  result: {
    response: string;
    toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
    toolResults: string[];
    assertions: Array<{text: string; negated: boolean; passed: boolean; reason: string}>;
    durationMs: number;
    error?: string;
    queryCost?: EvalCostInfo;
    judgeCost?: EvalCostInfo;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the runtime's own base URL from the incoming request.
 * Used for internal fetch calls to /chat.
 */
function selfBaseUrl(req: Request): string {
  const addr = req.socket.localAddress;
  const port = req.socket.localPort;
  if (!addr || !port) {
    throw new Error('Cannot determine server address from request socket');
  }
  return `http://${addr}:${String(port)}`;
}

/**
 * Send a message to the runtime's own /chat endpoint and collect the
 * full response, tool calls, and usage from the SSE stream.
 */
async function queryChat(
  baseUrl: string,
  message: string,
  model?: {provider: string; model: string},
  signal?: AbortSignal,
): Promise<{
  response: string;
  toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
  toolResults: string[];
  usage?: {inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number};
}> {
  const body: Record<string, unknown> = {
    message,
    session_id: `eval-${crypto.randomUUID()}`,
  };
  if (model) {
    body['model'] = `${model.provider}/${model.model}`;
  }

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal,
  });

  const sseText = await res.text();
  let fullResponse = '';
  const toolCalls: Array<{name: string; parameters: Record<string, unknown>}> = [];
  const toolResults: string[] = [];
  let usage: {inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number} | undefined;

  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary
      const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
      if (event['type'] === 'text_delta') {
        fullResponse += String(event['content'] ?? '');
      } else if (event['type'] === 'tool_call_start') {
        toolCalls.push({
          name: String(event['tool_name'] ?? ''),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- event field
          parameters: (event['parameters'] ?? {}) as Record<string, unknown>,
        });
      } else if (event['type'] === 'tool_call_result') {
        const result = String(event['result'] ?? event['error'] ?? '');
        const preview = result.length > 300 ? result.substring(0, 300) + '...' : result;
        toolResults.push(preview);
      } else if (event['type'] === 'done') {
        if (event['usage']) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- event field
          const u = event['usage'] as Record<string, unknown>;
          const inputTokens = Number(u['input_tokens'] ?? 0);
          const outputTokens = Number(u['output_tokens'] ?? 0);
          if (inputTokens > 0 || outputTokens > 0) {
            usage = {
              inputTokens,
              outputTokens,
              ...(u['cache_read_input_tokens'] ? {cacheReadInputTokens: Number(u['cache_read_input_tokens'])} : {}),
              ...(u['cache_creation_input_tokens'] ? {cacheCreationInputTokens: Number(u['cache_creation_input_tokens'])} : {}),
            };
          }
        }
      }
    } catch (err) {
      log.debug('eval_sse_parse_skip', {error: err instanceof Error ? err.message : String(err)});
    }
  }

  // Estimate usage if runtime didn't report it
  if (!usage) {
    const outputChars = fullResponse.length + toolCalls.reduce((n, tc) => n + JSON.stringify(tc.parameters).length, 0);
    const estimatedOutput = Math.ceil(outputChars / 4);
    const estimatedInput = estimatedOutput * 3;
    usage = {inputTokens: estimatedInput, outputTokens: estimatedOutput};
  }

  return {response: fullResponse, toolCalls, toolResults, usage};
}

/**
 * Create a judge provider that uses the runtime's own /chat endpoint.
 */
function createJudgeProvider(baseUrl: string): JudgeProvider {
  return {
    judge: async (prompt: string) => {
      const res = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message: prompt,
          session_id: `judge-${crypto.randomUUID()}`,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const sseText = await res.text();
      let result = '';
      for (const line of sseText.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary
          const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
          if (event['type'] === 'text_delta') {
            result += String(event['content'] ?? '');
          }
        } catch (err) {
          log.debug('judge_sse_parse_skip', {error: err instanceof Error ? err.message : String(err)});
        }
      }
      return result;
    },
  };
}

/**
 * Write an SSE event to the response.
 */
function sendSSE(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createEvalRouter(options: EvalRouterOptions): Router {
  const router = Router();

  router.post('/api/evals/run', asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express body
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || !Array.isArray(body['evalNames']) || body['evalNames'].length === 0) {
      res.status(400).json({
        error: {code: 'BAD_REQUEST', message: 'Request body must include "evalNames" as a non-empty array'},
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    const {evalNames, model} = body as unknown as EvalRunBody;
    const bundle = options.getBundle();
    const baseUrl = selfBaseUrl(req);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const judgeProvider = createJudgeProvider(baseUrl);
    const modelName = model ? model.model : (bundle.config.models?.main?.model ?? 'unknown');

    log.info('eval_run_started', {evalNames, model: modelName, evalCount: evalNames.length});

    try {
      for (const evalName of evalNames) {
        if (controller.signal.aborted) break;

        // Find eval in bundle
        const ev = bundle.evals.find((e) => e.name === evalName);
        if (!ev) {
          sendSSE(res, {
            type: 'eval_complete',
            evalName,
            passed: false,
            result: {
              response: '',
              toolCalls: [],
              toolResults: [],
              assertions: [],
              durationMs: 0,
              error: `Eval "${evalName}" not found in agent bundle`,
            },
          });
          continue;
        }

        const start = Date.now();

        try {
          // Run the query through the runtime's chat
          const queryResult = await queryChat(baseUrl, ev.query, model, controller.signal);

          // Signal query done — ArenaPage uses this for the "judging" phase indicator
          sendSSE(res, {type: 'done', usage: queryResult.usage ? {
            input_tokens: queryResult.usage.inputTokens,
            output_tokens: queryResult.usage.outputTokens,
            ...(queryResult.usage.cacheReadInputTokens ? {cache_read_input_tokens: queryResult.usage.cacheReadInputTokens} : {}),
            ...(queryResult.usage.cacheCreationInputTokens ? {cache_creation_input_tokens: queryResult.usage.cacheCreationInputTokens} : {}),
          } : undefined});

          // Build enriched response for the judge (include tool call info)
          let enrichedResponse = queryResult.response;
          if (queryResult.toolCalls.length > 0) {
            const toolSummary = queryResult.toolCalls
              .map((tc) => `- ${tc.name}(${JSON.stringify(tc.parameters)})`)
              .join('\n');
            enrichedResponse += `\n\n## Tool Calls Made\n${toolSummary}`;
          }
          if (queryResult.toolResults.length > 0) {
            enrichedResponse += `\n\n## Tool Results\n${queryResult.toolResults.map((r) => `- ${r}`).join('\n')}`;
          }

          // Judge all assertions
          const assertions = await judgeAllAssertions(enrichedResponse, ev.assertions, judgeProvider);
          const passed = assertions.every((a) => a.passed);
          const durationMs = Date.now() - start;

          // Compute costs
          const queryCost = queryResult.usage
            ? computeEvalCost(
                queryResult.usage.inputTokens,
                queryResult.usage.outputTokens,
                modelName,
                queryResult.usage.cacheReadInputTokens,
                queryResult.usage.cacheCreationInputTokens,
              )
            : undefined;

          const resultEvent: EvalResultEvent = {
            type: 'eval_complete',
            evalName,
            passed,
            result: {
              response: queryResult.response,
              toolCalls: queryResult.toolCalls,
              toolResults: queryResult.toolResults,
              assertions,
              durationMs,
              queryCost,
            },
          };

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structured event to JSON
          sendSSE(res, resultEvent as unknown as Record<string, unknown>);
        } catch (err) {
          if (controller.signal.aborted) break;
          const durationMs = Date.now() - start;

          sendSSE(res, {
            type: 'eval_complete',
            evalName,
            passed: false,
            result: {
              response: '',
              toolCalls: [],
              toolResults: [],
              assertions: ev.assertions.map((a) => ({
                text: a.text,
                negated: a.negated,
                passed: false,
                reason: `Eval execution error: ${err instanceof Error ? err.message : String(err)}`,
              })),
              durationMs,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        sendSSE(res, {
          type: 'agent_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.end();
  }));

  return router;
}
