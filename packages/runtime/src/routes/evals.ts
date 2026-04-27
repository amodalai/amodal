/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Eval execution route.
 *
 * Accepts POST to /api/evals/run, runs the specified evals from the
 * agent bundle against the session manager directly, judges the
 * results with an LLM, and streams SSE progress events back to the
 * caller (typically the Studio ArenaPage).
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {AgentBundle} from '@amodalai/types';
import {judgeAllAssertions, computeEvalCost} from '@amodalai/core';
import type {JudgeProvider, EvalCostInfo} from '@amodalai/core';
import {SSEEventType} from '../types.js';
import type {StandaloneSessionManager} from '../session/manager.js';
import {resolveSession} from './session-resolver.js';
import type {BundleResolver, SharedResources} from './session-resolver.js';
import {asyncHandler} from './route-helpers.js';
import {log} from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalRouterOptions {
  /** Returns the current agent bundle (may be hot-reloaded). */
  getBundle: () => AgentBundle;
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
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
 * Run a message through the session manager and collect the full response,
 * tool calls, tool results, and usage from the SSE event stream.
 */
async function queryViaSession(
  sessionManager: StandaloneSessionManager,
  bundleResolver: BundleResolver,
  shared: SharedResources,
  message: string,
  model?: {provider: string; model: string},
  signal?: AbortSignal,
): Promise<{
  response: string;
  toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
  toolResults: string[];
  usage?: {inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number};
}> {
  const {session, toolContextFactory} = await resolveSession(undefined, {
    sessionManager,
    bundleResolver,
    shared,
    ...(model ? {pinnedModel: model} : {}),
  });

  const stream = sessionManager.runMessage(session.id, message, {
    signal,
    buildToolContext: toolContextFactory,
  });

  let fullResponse = '';
  const toolCalls: Array<{name: string; parameters: Record<string, unknown>}> = [];
  const toolResults: string[] = [];
  let usage: {inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number} | undefined;

  // Track tool names by tool_id so we can match results
  const toolNames = new Map<string, string>();

  try {
    for await (const event of stream) {
      if (signal?.aborted) break;

      if (event.type === SSEEventType.TextDelta) {
        fullResponse += event.content;
      } else if (event.type === SSEEventType.ToolCallStart) {
        toolNames.set(event.tool_id, event.tool_name);
        toolCalls.push({
          name: event.tool_name,
          parameters: event.parameters,
        });
      } else if (event.type === SSEEventType.ToolCallResult) {
        const result = event.result ?? event.error ?? '';
        const preview = result.length > 300 ? result.substring(0, 300) + '...' : result;
        toolResults.push(preview);
      } else if (event.type === SSEEventType.Done) {
        if (event.usage) {
          const inputTokens = event.usage.input_tokens;
          const outputTokens = event.usage.output_tokens;
          if (inputTokens > 0 || outputTokens > 0) {
            usage = {
              inputTokens,
              outputTokens,
              ...(event.usage.cached_tokens ? {cacheReadInputTokens: event.usage.cached_tokens} : {}),
              ...(event.usage.cache_creation_tokens ? {cacheCreationInputTokens: event.usage.cache_creation_tokens} : {}),
            };
          }
        }
      }
    }
  } finally {
    // Destroy the eval session — eval sessions are ephemeral
    await sessionManager.destroy(session.id);
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
 * Create a judge provider that runs messages through the session manager.
 */
function createJudgeProvider(
  sessionManager: StandaloneSessionManager,
  bundleResolver: BundleResolver,
  shared: SharedResources,
): JudgeProvider {
  return {
    judge: async (prompt: string) => {
      const {session, toolContextFactory} = await resolveSession(undefined, {
        sessionManager,
        bundleResolver,
        shared,
      });

      const stream = sessionManager.runMessage(session.id, prompt, {
        signal: AbortSignal.timeout(120_000),
        buildToolContext: toolContextFactory,
      });

      let result = '';
      try {
        for await (const event of stream) {
          if (event.type === SSEEventType.TextDelta) {
            result += event.content;
          }
        }
      } finally {
        await sessionManager.destroy(session.id);
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

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const judgeProvider = createJudgeProvider(
      options.sessionManager,
      options.bundleResolver,
      options.shared,
    );
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
          // Run the query through the session manager directly
          const queryResult = await queryViaSession(
            options.sessionManager,
            options.bundleResolver,
            options.shared,
            ev.query,
            model,
            controller.signal,
          );

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
