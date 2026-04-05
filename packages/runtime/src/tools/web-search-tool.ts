/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * web_search tool — grounded search via Gemini Flash.
 *
 * The tool delegates to `ctx.searchProvider.search()` (a dedicated Gemini
 * provider configured via `webTools` in amodal.json), then formats the
 * synthesized answer with cited source URLs as markdown.
 *
 * Works for agents on any main model (Anthropic/OpenAI/Google) — search
 * always runs through the Gemini backend regardless of main provider.
 */

import {z} from 'zod';
import {WEB_SEARCH_TOOL_NAME} from '@amodalai/core';
import {log} from '../logger.js';
import {ProviderError, ToolExecutionError} from '../errors.js';
import {truncateToTokens, MAX_WEB_TOOL_RESULT_TOKENS} from './web-tools-shared.js';
import type {SearchSource} from '../providers/search-provider.js';
import type {ToolDefinition, ToolContext} from './types.js';

export {WEB_SEARCH_TOOL_NAME};

// ---------------------------------------------------------------------------
// Params schema
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 10;

const WebSearchParamsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Search query. Be specific — include dates, names, error messages as relevant.'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_ALLOWED_RESULTS)
    .optional()
    .describe(`Maximum source citations to include (default: ${String(DEFAULT_MAX_RESULTS)}, max: ${String(MAX_ALLOWED_RESULTS)}).`),
});

type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface WebSearchToolResult {
  status: 'ok' | 'error';
  content: string;
  source_count?: number;
  retryable?: boolean;
}

/**
 * Map a provider error to an actionable message for the agent. The goal is
 * to let the model know whether retrying will help, so it doesn't burn
 * turns retrying something that's permanently broken.
 */
function classifyProviderError(err: ProviderError): {content: string; retryable: boolean} {
  const status = err.statusCode;
  if (status === 400 || status === 401 || status === 403) {
    return {
      content:
        'Web search is not authorized. The Google API key is missing, invalid, or not permitted for this model. ' +
        'DO NOT retry. Tell the user to check the GOOGLE_API_KEY configured for webTools in amodal.json.',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      content:
        'Web search is rate-limited or the Gemini grounding quota is exhausted. ' +
        'DO NOT retry this search in the current turn. Continue with other tools or finish the task without search.',
      retryable: false,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      content:
        `Web search failed transiently (status ${String(status)}). ` +
        'You may retry once with the same or a slightly different query. If it fails again, continue without search.',
      retryable: true,
    };
  }
  return {
    content: `Web search failed: ${err.message}. Do not retry without changing the query.`,
    retryable: false,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatResult(text: string, sources: SearchSource[], maxResults: number): string {
  const capped = sources.slice(0, maxResults);
  if (capped.length === 0) {
    return `${text}\n\n_(no sources cited)_`;
  }
  const lines: string[] = [text.trim(), '', 'Sources:'];
  for (let i = 0; i < capped.length; i++) {
    const source = capped[i];
    if (!source) continue;
    const titlePart = source.title ? ` — ${source.title}` : '';
    lines.push(`[${String(i + 1)}] ${source.uri}${titlePart}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWebSearchTool(): ToolDefinition<WebSearchParams> {
  return {
    description: `Search the web for current information. Use when the user asks about recent events, current versions of libraries, news, or any fact you do not already know with confidence. Returns a synthesized answer with cited source URLs.

When to use:
- User asks "what is the latest/current X"
- Question about events after your knowledge cutoff
- Looking up specific facts, documentation, or error messages
- Verifying a claim with external sources

When NOT to use:
- Questions fully answerable from conversation history or knowledge files
- Internal agent workflows (use connections instead)
- Retrieving a specific URL (use fetch_url instead)

Query strategy (write queries that steer search toward authoritative sources):
- Code / library questions → include "github" or the package name (e.g. "nextjs app router github docs")
- API documentation → include the vendor name + "docs" (e.g. "stripe docs customer object")
- Version / release lookups → add "release notes" or "changelog" and the repo (e.g. "nodejs release notes site:github.com/nodejs/node")
- Error messages → paste the exact error text verbatim, no rephrasing
- Recent events → include the **current year or month** (from the currentDate in your context, not your pretraining era) to anchor the timeframe
- Ambiguous names → add a qualifier ("Python library", "JavaScript", the vendor) so the model searches the right thing

If the first query returns off-topic results, rewrite more specifically and search again — don't guess.`,

    parameters: WebSearchParamsSchema,
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params, ctx: ToolContext): Promise<WebSearchToolResult> {
      const maxResults = params.max_results ?? DEFAULT_MAX_RESULTS;

      if (!ctx.searchProvider) {
        return {
          status: 'error',
          content:
            'Web search is not configured. Set `webTools.apiKey` in amodal.json to enable web_search.',
        };
      }

      const started = Date.now();
      try {
        const result = await ctx.searchProvider.search(params.query, {signal: ctx.signal});
        const formatted = formatResult(result.text, result.sources, maxResults);
        const content = truncateToTokens(formatted, MAX_WEB_TOOL_RESULT_TOKENS);

        log.info('web_search', {
          session: ctx.sessionId,
          query_length: params.query.length,
          result_count: result.sources.length,
          duration_ms: Date.now() - started,
        });

        return {
          status: 'ok',
          content,
          source_count: Math.min(result.sources.length, maxResults),
        };
      } catch (err) {
        log.error('web_search_failed', {
          session: ctx.sessionId,
          query_length: params.query.length,
          duration_ms: Date.now() - started,
          status_code: err instanceof ProviderError ? err.statusCode : undefined,
          error: err instanceof Error ? err.message : String(err),
        });
        // Return structured guidance for provider errors so the agent
        // knows whether to retry. Unexpected errors still throw — those
        // are bugs, not runtime conditions.
        if (err instanceof ProviderError) {
          const {content, retryable} = classifyProviderError(err);
          return {status: 'error', content, retryable};
        }
        throw new ToolExecutionError('web_search failed', {
          toolName: WEB_SEARCH_TOOL_NAME,
          callId: ctx.sessionId,
          cause: err,
        });
      }
    },
  };
}
