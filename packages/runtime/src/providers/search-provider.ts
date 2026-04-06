/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Search provider: dedicated Gemini Flash instance for web_search + fetch_url.
 *
 * This is SEPARATE from the main LLM provider. Regardless of what model the
 * agent is using (Anthropic/OpenAI/Google), web search and URL fetch always
 * route through a Gemini Flash call with Google Search + urlContext grounding
 * enabled. That gives us synthesized answers with cited URLs without paying
 * the main-model rate and without coupling search to the main provider.
 *
 * Deviation from the implementation plan: the plan said to return an
 * `LLMProvider` wrapper, but `LLMProvider.generateText` doesn't expose
 * `providerMetadata`, which is where grounding sources live. Rather than
 * pollute `LLMProvider` with Google-specific fields, we return a narrow
 * purpose-specific interface with `search()` and `fetchUrl()` methods that
 * yield `{ text, sources }` shaped results.
 */

import {generateText} from 'ai';
import {createGoogleGenerativeAI} from '@ai-sdk/google';
import type {WebToolsConfig} from '@amodalai/types';
import {ConfigError, ProviderError} from '../errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Gemini model for search + urlContext when none is configured. */
export const DEFAULT_SEARCH_MODEL = 'gemini-3-flash-preview';

/**
 * Preamble prepended to every grounded search query. Biases Gemini toward
 * authoritative sources and precise citation. ~30 tokens per call.
 */
const SEARCH_SYSTEM_PREAMBLE =
  'Prefer authoritative sources: official documentation, GitHub, package registries, release notes. ' +
  'When asked for a version number, date, or other exact value, cite it directly from the source. ' +
  'If sources disagree, say so.';

/** Timeout for individual Gemini grounding calls. Separate from the tool-level
 *  ctx.signal so the fallback path still has time if the primary is slow. */
const GROUNDING_TIMEOUT_MS = 15_000;

/** Tool names required by the Google provider — must match SDK expectations. */
const GOOGLE_SEARCH_TOOL_NAME = 'google_search';
const URL_CONTEXT_TOOL_NAME = 'url_context';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single grounded source citation (from googleSearch or urlContext). */
export interface SearchSource {
  /** Fully-qualified source URL. */
  uri: string;
  /** Human-readable title if the provider supplied one. */
  title?: string;
}

/** Result of a grounded search query. */
export interface SearchResult {
  /** Synthesized answer text from the model. */
  text: string;
  /** Source URLs the answer was grounded in (may be empty). */
  sources: SearchSource[];
}

/** Result of a grounded URL fetch. */
export interface FetchResult {
  /** Extracted page content as markdown (or summary if `prompt` was provided). */
  text: string;
  /** URLs that were actually retrieved by urlContext (usually 1, may be 0 on failure). */
  retrievedUrls: string[];
}

/** Options for a single search call. */
export interface SearchOptions {
  /** Abort signal for cancellation/timeout. */
  signal?: AbortSignal;
}

/** Options for a single fetch call. */
export interface FetchOptions {
  /** Extraction prompt — what to pull from the page. Defaults to "render as markdown". */
  prompt?: string;
  /** Abort signal for cancellation/timeout. */
  signal?: AbortSignal;
}

/**
 * Narrow, purpose-specific interface for grounded search + fetch.
 *
 * Not an `LLMProvider` — it returns grounding metadata that `LLMProvider`
 * doesn't surface. Tool executors (`web_search`, `fetch_url`) depend on
 * this interface, not on the concrete AI SDK types.
 */
export interface SearchProvider {
  /** Run a grounded search query. */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>;
  /** Fetch + extract content from a URL using urlContext grounding. */
  fetchUrl(url: string, opts?: FetchOptions): Promise<FetchResult>;
  /** Model identifier used for introspection/logging. */
  readonly model: string;
}

// ---------------------------------------------------------------------------
// Grounding metadata shape (from @ai-sdk/google providerMetadata)
// ---------------------------------------------------------------------------

/**
 * Subset of the Google provider metadata we actually read.
 *
 * The AI SDK exposes a wider schema — we only pick what the tools need.
 * Everything we don't read is treated as `unknown` on purpose: this is
 * an external boundary and we validate structurally before using.
 */
interface GoogleProviderMetadata {
  groundingMetadata?: {
    groundingChunks?: Array<{
      web?: {uri?: string; title?: string};
    }> | null;
  } | null;
  urlContextMetadata?: {
    urlMetadata?: Array<{
      retrievedUrl?: string;
      urlRetrievalStatus?: string;
    }> | null;
  } | null;
}

function extractGoogleMetadata(
  providerMetadata: Record<string, unknown> | undefined,
): GoogleProviderMetadata | undefined {
  if (!providerMetadata) return undefined;
  const google = providerMetadata['google'];
  if (!google || typeof google !== 'object') return undefined;
  return google as GoogleProviderMetadata;
}

function extractSources(metadata: GoogleProviderMetadata | undefined): SearchSource[] {
  const chunks = metadata?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const sources: SearchSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (typeof uri === 'string' && uri.length > 0) {
      sources.push({
        uri,
        ...(chunk.web?.title ? {title: chunk.web.title} : {}),
      });
    }
  }
  return sources;
}

/**
 * Extract an HTTP status code from an AI SDK error if present. The SDK wraps
 * provider failures in `AI_APICallError` which carries `statusCode`. We use
 * this to classify failures into auth/quota/transient for the tool executors.
 */
function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as {statusCode: unknown}).statusCode;
    if (typeof code === 'number') return code;
  }
  // Error wrapper — check cause
  if (err instanceof Error && err.cause) return extractStatusCode(err.cause);
  return undefined;
}

function extractRetrievedUrls(metadata: GoogleProviderMetadata | undefined): string[] {
  const entries = metadata?.urlContextMetadata?.urlMetadata;
  if (!Array.isArray(entries)) return [];
  const urls: string[] = [];
  for (const entry of entries) {
    if (typeof entry.retrievedUrl === 'string' && entry.retrievedUrl.length > 0) {
      urls.push(entry.retrievedUrl);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SearchProvider from webTools config.
 *
 * Throws `ConfigError` when the provider string is unsupported. All
 * current config values go through Zod validation at load time, so this
 * is defensive rather than user-facing.
 */
export function createSearchProvider(config: WebToolsConfig): SearchProvider {
  if (config.provider !== 'google') {
    throw new ConfigError(`Unsupported webTools provider: ${config.provider}`, {
      key: 'webTools.provider',
      suggestion: 'Only "google" is supported today.',
    });
  }

  const google = createGoogleGenerativeAI({apiKey: config.apiKey});
  const modelId = config.model ?? DEFAULT_SEARCH_MODEL;
  const model = google(modelId);

  return {
    model: modelId,

    async search(query, opts): Promise<SearchResult> {
      try {
        const result = await generateText({
          model,
          system: SEARCH_SYSTEM_PREAMBLE,
          prompt: query,
          tools: {
            [GOOGLE_SEARCH_TOOL_NAME]: google.tools.googleSearch({}),
          },
          abortSignal: opts?.signal
            ? AbortSignal.any([opts.signal, AbortSignal.timeout(GROUNDING_TIMEOUT_MS)])
            : AbortSignal.timeout(GROUNDING_TIMEOUT_MS),
        });
        const metadata = extractGoogleMetadata(result.providerMetadata);
        return {
          text: result.text,
          sources: extractSources(metadata),
        };
      } catch (err) {
        const statusCode = extractStatusCode(err);
        throw new ProviderError('Grounded search failed', {
          provider: 'google',
          ...(statusCode !== undefined ? {statusCode} : {}),
          retryable: statusCode !== undefined && statusCode >= 500,
          context: {model: modelId, operation: 'search'},
          cause: err,
        });
      }
    },

    async fetchUrl(url, opts): Promise<FetchResult> {
      const prompt = opts?.prompt
        ? `Fetch ${url} and ${opts.prompt}. Respond with the result.`
        : `Fetch ${url} and render the page content as markdown. Preserve headings, links, and lists.`;
      try {
        const result = await generateText({
          model,
          prompt,
          tools: {
            [URL_CONTEXT_TOOL_NAME]: google.tools.urlContext({}),
          },
          abortSignal: opts?.signal
            ? AbortSignal.any([opts.signal, AbortSignal.timeout(GROUNDING_TIMEOUT_MS)])
            : AbortSignal.timeout(GROUNDING_TIMEOUT_MS),
        });
        const metadata = extractGoogleMetadata(result.providerMetadata);
        return {
          text: result.text,
          retrievedUrls: extractRetrievedUrls(metadata),
        };
      } catch (err) {
        const statusCode = extractStatusCode(err);
        throw new ProviderError('Grounded URL fetch failed', {
          provider: 'google',
          ...(statusCode !== undefined ? {statusCode} : {}),
          retryable: statusCode !== undefined && statusCode >= 500,
          context: {model: modelId, operation: 'fetchUrl', url},
          cause: err,
        });
      }
    },
  };
}
