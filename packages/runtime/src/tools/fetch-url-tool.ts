/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * fetch_url tool — grounded URL fetch via Gemini urlContext, with a local
 * fetch + Readability fallback for internal URLs or Gemini failures.
 *
 * Flow:
 *   1. If the URL targets a private network (localhost / RFC1918 / .local)
 *      OR `ctx.searchProvider` is unavailable, run the local fallback.
 *   2. Otherwise try Gemini urlContext first. If that fails or returns
 *      empty content, fall through to the local fallback.
 *   3. Local fallback uses linkedom + Mozilla Readability to extract the
 *      main content, then returns it as text/markdown.
 *
 * Per-hostname rate limiting: 10 requests / 60 seconds, in-memory.
 */

import {Readability} from '@mozilla/readability';
import {parseHTML} from 'linkedom';
import {z} from 'zod';
import {FETCH_URL_TOOL_NAME} from '@amodalai/core';
import {log} from '../logger.js';
import {ToolExecutionError} from '../errors.js';
import {truncateToTokens, MAX_WEB_TOOL_RESULT_TOKENS} from './web-tools-shared.js';
import type {SearchProvider} from '../providers/search-provider.js';
import type {ToolDefinition, ToolContext} from './types.js';

export {FETCH_URL_TOOL_NAME};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for the local fetch fallback (ms). */
const LOCAL_FETCH_TIMEOUT_MS = 10_000;

/** Max response body size for the local fetch fallback (bytes). */
const LOCAL_FETCH_MAX_BYTES = 1_000_000;

/** Rate-limit window size (ms). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Max requests per hostname per window. */
const RATE_LIMIT_MAX_REQUESTS = 10;

// ---------------------------------------------------------------------------
// Internal error type for the local fetch path
// ---------------------------------------------------------------------------

/**
 * Internal signaling error thrown by `fetchLocally()`. Always caught and
 * re-wrapped in `ToolExecutionError` at the tool boundary — it never escapes
 * the module. Carrying the hostname/status/size on the error lets the
 * wrapping layer include that context in the structured error response.
 */
class LocalFetchError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = 'LocalFetchError';
    this.context = context;
  }
}

// ---------------------------------------------------------------------------
// Params schema
// ---------------------------------------------------------------------------

const FetchUrlParamsSchema = z.object({
  url: z
    .string()
    .url()
    .describe('Absolute URL to fetch. Must be http:// or https://.'),
  prompt: z
    .string()
    .optional()
    .describe('Optional extraction prompt: what specifically to pull from the page. When omitted, the full page is rendered as markdown.'),
});

type FetchUrlParams = z.infer<typeof FetchUrlParamsSchema>;

interface FetchUrlToolResult {
  status: 'ok' | 'error';
  content: string;
  used_fallback?: boolean;
}

// ---------------------------------------------------------------------------
// Rate limiter (per-hostname sliding window)
// ---------------------------------------------------------------------------

const hostRequestTimestamps = new Map<string, number[]>();

interface RateLimitCheck {
  ok: boolean;
  /** When the next request to this host would be allowed, in ms since epoch. */
  retryAtMs?: number;
}

function checkRateLimit(hostname: string): RateLimitCheck {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (hostRequestTimestamps.get(hostname) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = timestamps[0] ?? now;
    return {ok: false, retryAtMs: oldest + RATE_LIMIT_WINDOW_MS};
  }

  timestamps.push(now);
  hostRequestTimestamps.set(hostname, timestamps);
  return {ok: true};
}

/** Reset rate-limit state (test helper). */
export function resetRateLimitForTesting(): void {
  hostRequestTimestamps.clear();
}

// ---------------------------------------------------------------------------
// Private network detection
// ---------------------------------------------------------------------------

const PRIVATE_IPV4_PREFIXES = ['10.', '192.168.'];

function isPrivateNetworkHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.localhost')) {
    return true;
  }
  if (lower === '127.0.0.1' || lower === '::1' || lower === '[::1]') {
    return true;
  }
  if (lower.startsWith('127.')) return true;
  for (const prefix of PRIVATE_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  // 172.16.0.0 – 172.31.255.255
  if (lower.startsWith('172.')) {
    const parts = lower.split('.');
    const second = parts[1];
    if (second !== undefined) {
      const n = Number(second);
      if (Number.isInteger(n) && n >= 16 && n <= 31) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Local fetch + Readability fallback
// ---------------------------------------------------------------------------

async function fetchLocally(url: string, signal: AbortSignal): Promise<string> {
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(LOCAL_FETCH_TIMEOUT_MS)]);

  const response = await fetch(url, {
    signal: combinedSignal,
    headers: {
      'User-Agent': 'Amodal/fetch_url',
      'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new LocalFetchError(`HTTP ${String(response.status)} ${response.statusText}`, {
      url,
      status: response.status,
      statusText: response.statusText,
    });
  }

  // Enforce size limit while reading. `content-length` can be absent
  // (chunked responses), so we also stream-check via the returned bytes.
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > LOCAL_FETCH_MAX_BYTES) {
      throw new LocalFetchError(
        `Response too large: ${String(declared)} bytes (limit ${String(LOCAL_FETCH_MAX_BYTES)})`,
        {url, declaredBytes: declared, limit: LOCAL_FETCH_MAX_BYTES},
      );
    }
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > LOCAL_FETCH_MAX_BYTES) {
    throw new LocalFetchError(
      `Response too large: ${String(buffer.byteLength)} bytes (limit ${String(LOCAL_FETCH_MAX_BYTES)})`,
      {url, actualBytes: buffer.byteLength, limit: LOCAL_FETCH_MAX_BYTES},
    );
  }
  const html = new TextDecoder('utf-8', {fatal: false}).decode(buffer);
  return extractWithReadability(html, url);
}

function extractWithReadability(html: string, url: string): string {
  const {document} = parseHTML(html);
  // Readability's Document type is DOM-lib; linkedom's is structurally
  // compatible but typed independently. Cast at this external boundary.
  // linkedom returns a linkedom-typed `Document`; Readability declares the
  // DOM-lib `Document` type. They are structurally compatible at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- linkedom→DOM boundary for Readability
  const article = new Readability(document as any).parse();

  if (article?.textContent && article.textContent.trim().length > 0) {
    const title = article.title ? `# ${article.title}\n\n` : '';
    return `${title}${article.textContent.trim()}\n\n_Source: ${url}_`;
  }

  // Readability couldn't extract — strip tags as last resort.
  return `${stripHtml(html)}\n\n_Source: ${url}_`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface ParsedUrl {
  hostname: string;
  isPrivate: boolean;
}

function parseAndClassify(rawUrl: string): ParsedUrl {
  // URL constructor throws on malformed input — validated upstream by Zod,
  // but we re-parse here to extract hostname.
  const parsed = new URL(rawUrl);
  return {
    hostname: parsed.hostname,
    isPrivate: isPrivateNetworkHost(parsed.hostname),
  };
}

// ---------------------------------------------------------------------------
// Primary path (Gemini urlContext)
// ---------------------------------------------------------------------------

async function fetchViaSearchProvider(
  provider: SearchProvider,
  url: string,
  userPrompt: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const result = await provider.fetchUrl(url, {
    ...(userPrompt ? {prompt: userPrompt} : {}),
    signal,
  });
  return result.text;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFetchUrlTool(): ToolDefinition<FetchUrlParams> {
  return {
    description: `Fetch the content of a specific URL. Returns the page content as markdown. Use when you need the actual content of a web page, documentation, or API response you already know the URL for.

When to use:
- You have a specific URL the user referenced or web_search surfaced
- You need the full content of a documentation page or article
- Retrieving a raw text or JSON resource

When NOT to use:
- Searching — use web_search
- Hitting a configured API connection — use the request tool
- The URL is a user-protected resource (auth/cookies required)`,

    parameters: FetchUrlParamsSchema,
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params, ctx: ToolContext): Promise<FetchUrlToolResult> {
      const started = Date.now();
      const {url, prompt} = params;

      let parsed: ParsedUrl;
      try {
        parsed = parseAndClassify(url);
      } catch (err) {
        return {
          status: 'error',
          content: `Invalid URL: ${err instanceof Error ? err.message : 'parse failed'}`,
        };
      }

      const protocol = new URL(url).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') {
        return {
          status: 'error',
          content: `Only http:// and https:// URLs are supported (got ${protocol}).`,
        };
      }

      // Rate limit check
      const limitCheck = checkRateLimit(parsed.hostname);
      if (!limitCheck.ok) {
        const retryInSec = Math.max(
          1,
          Math.ceil(((limitCheck.retryAtMs ?? Date.now()) - Date.now()) / 1000),
        );
        log.warn('fetch_url_rate_limited', {
          session: ctx.sessionId,
          hostname: parsed.hostname,
          retry_in_sec: retryInSec,
        });
        return {
          status: 'error',
          content: `Rate limited for ${parsed.hostname}. Try again in ${String(retryInSec)}s.`,
        };
      }

      // Decide path. The condition narrows `ctx.searchProvider` inside the
      // primary branch so we can use it without a non-null assertion.
      let usedFallback = false;
      let text: string;

      if (!parsed.isPrivate && ctx.searchProvider) {
        const provider = ctx.searchProvider;
        try {
          text = await fetchViaSearchProvider(provider, url, prompt, ctx.signal);
          // Empty response from Gemini → try local
          if (!text || text.trim().length === 0) {
            text = await fetchLocally(url, ctx.signal);
            usedFallback = true;
          }
        } catch (primaryErr) {
          log.warn('fetch_url_primary_failed', {
            session: ctx.sessionId,
            hostname: parsed.hostname,
            error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
          });
          try {
            text = await fetchLocally(url, ctx.signal);
            usedFallback = true;
          } catch (fallbackErr) {
            log.error('fetch_url_failed', {
              session: ctx.sessionId,
              hostname: parsed.hostname,
              duration_ms: Date.now() - started,
              path: 'fallback',
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            });
            throw new ToolExecutionError('fetch_url failed (primary + fallback)', {
              toolName: FETCH_URL_TOOL_NAME,
              callId: ctx.sessionId,
              cause: fallbackErr,
              context: {primaryError: primaryErr instanceof Error ? primaryErr.message : String(primaryErr)},
            });
          }
        }
      } else {
        // Private network or no searchProvider configured — local only.
        try {
          text = await fetchLocally(url, ctx.signal);
          usedFallback = true;
        } catch (err) {
          log.error('fetch_url_failed', {
            session: ctx.sessionId,
            hostname: parsed.hostname,
            duration_ms: Date.now() - started,
            path: 'local',
            error: err instanceof Error ? err.message : String(err),
          });
          throw new ToolExecutionError('fetch_url failed (local fetch)', {
            toolName: FETCH_URL_TOOL_NAME,
            callId: ctx.sessionId,
            cause: err,
          });
        }
      }

      const content = truncateToTokens(text, MAX_WEB_TOOL_RESULT_TOKENS);

      log.info('fetch_url', {
        session: ctx.sessionId,
        hostname: parsed.hostname,
        duration_ms: Date.now() - started,
        bytes: text.length,
        used_fallback: usedFallback,
      });

      return {
        status: 'ok',
        content,
        used_fallback: usedFallback,
      };
    },
  };
}
