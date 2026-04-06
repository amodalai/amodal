/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createFetchUrlTool, resetRateLimitForTesting} from './fetch-url-tool.js';
import type {SearchProvider, FetchResult} from '../providers/search-provider.js';
import type {ToolContext} from './types.js';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    signal: AbortSignal.timeout(5000),
    sessionId: 'test-session',
    ...overrides,
  };
}

function makeProvider(result: FetchResult, opts?: {throws?: Error}): SearchProvider {
  const fetchMock = opts?.throws
    ? vi.fn().mockRejectedValue(opts.throws)
    : vi.fn().mockResolvedValue(result);
  return {
    model: 'gemini-2.5-flash',
    search: vi.fn(),
    fetchUrl: fetchMock,
  };
}

async function runTool(ctx: ToolContext, params: {url: string; prompt?: string}): Promise<{
  status: string;
  content: string;
  used_fallback?: boolean;
}> {
  const tool = createFetchUrlTool();
  const raw = await tool.execute(params, ctx);
  return raw as {status: string; content: string; used_fallback?: boolean};
}

/** Build a simple HTML document with enough content for Readability to accept. */
function htmlPage(title: string, body: string): string {
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30);
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p><p>${filler}</p></article></body></html>`;
}

describe('fetch_url tool', () => {
  beforeEach(() => {
    resetRateLimitForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('primary path (Gemini urlContext)', () => {
    it('uses the search provider for public URLs and returns content', async () => {
      const provider = makeProvider({text: '# Example\n\nContent here.', retrievedUrls: ['https://example.com']});
      const ctx = makeCtx({searchProvider: provider});

      const result = await runTool(ctx, {url: 'https://example.com'});

      expect(result.status).toBe('ok');
      expect(result.used_fallback).toBe(false);
      expect(result.content).toContain('Example');
      expect(provider.fetchUrl).toHaveBeenCalledTimes(1);
    });

    it('passes the user prompt through to the provider', async () => {
      const provider = makeProvider({text: 'summary', retrievedUrls: ['https://example.com']});
      const ctx = makeCtx({searchProvider: provider});

      await runTool(ctx, {url: 'https://example.com', prompt: 'extract the price'});

      expect(provider.fetchUrl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({prompt: 'extract the price'}),
      );
    });

    it('falls back to local fetch when Gemini returns empty content', async () => {
      const provider = makeProvider({text: '', retrievedUrls: []});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(htmlPage('Page Title', 'Body content here'), {
            status: 200,
            headers: {'content-type': 'text/html'},
          }),
        ),
      );
      const ctx = makeCtx({searchProvider: provider});

      const result = await runTool(ctx, {url: 'https://example.com'});

      expect(result.status).toBe('ok');
      expect(result.used_fallback).toBe(true);
      expect(result.content).toContain('Page Title');
    });

    it('falls back to local fetch when Gemini throws', async () => {
      const provider = makeProvider({text: '', retrievedUrls: []}, {throws: new Error('gemini-down')});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(htmlPage('Fallback', 'Content'), {status: 200}),
        ),
      );
      const ctx = makeCtx({searchProvider: provider});

      const result = await runTool(ctx, {url: 'https://example.com'});

      expect(result.status).toBe('ok');
      expect(result.used_fallback).toBe(true);
    });
  });

  describe('local fallback path', () => {
    it('uses local fetch when no searchProvider is configured', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(htmlPage('Local Only', 'Content'), {status: 200}),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx(); // no searchProvider

      const result = await runTool(ctx, {url: 'https://example.com'});

      expect(result.status).toBe('ok');
      expect(result.used_fallback).toBe(true);
      expect(result.content).toContain('Local Only');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('uses local fetch for private network URLs even when provider is configured', async () => {
      const provider = makeProvider({text: 'wont be used', retrievedUrls: []});
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(htmlPage('Local', 'Content'), {status: 200}),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx({searchProvider: provider});

      const result = await runTool(ctx, {url: 'http://localhost:8080/health'});

      expect(result.used_fallback).toBe(true);
      expect(provider.fetchUrl).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('classifies 127.0.0.1 as private', async () => {
      const fetchMock = vi.fn().mockImplementation(
        () => Promise.resolve(new Response(htmlPage('x', 'y'), {status: 200})),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx({searchProvider: makeProvider({text: 'x', retrievedUrls: []})});

      await runTool(ctx, {url: 'http://127.0.0.1:3000'});

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('classifies RFC1918 10.x and 192.168.x as private', async () => {
      const fetchMock = vi.fn().mockImplementation(
        () => Promise.resolve(new Response(htmlPage('x', 'y'), {status: 200})),
      );
      vi.stubGlobal('fetch', fetchMock);
      const provider = makeProvider({text: 'x', retrievedUrls: []});
      const ctx = makeCtx({searchProvider: provider});

      await runTool(ctx, {url: 'http://10.0.0.5/api'});
      await runTool(ctx, {url: 'http://192.168.1.100/'});

      expect(provider.fetchUrl).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects oversized responses', async () => {
      const huge = 'a'.repeat(2_000_000);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(huge, {status: 200})),
      );
      const ctx = makeCtx();
      const tool = createFetchUrlTool();

      await expect(
        tool.execute({url: 'https://example.com'}, ctx),
      ).rejects.toMatchObject({name: 'ToolExecutionError'});
    });

    it('throws when the local HTTP call returns non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('not found', {status: 404})),
      );
      const ctx = makeCtx();
      const tool = createFetchUrlTool();

      await expect(
        tool.execute({url: 'https://example.com/missing'}, ctx),
      ).rejects.toMatchObject({name: 'ToolExecutionError'});
    });
  });

  describe('URL validation', () => {
    it('rejects non-http(s) protocols', async () => {
      const ctx = makeCtx();
      const result = await runTool(ctx, {url: 'ftp://example.com/file'});
      // Zod .url() rejects ftp://? Actually it accepts it — our runtime check fires.
      // If Zod rejected, this test would never reach execute; Zod .url() does NOT require http.
      expect(result.status).toBe('error');
      expect(result.content).toContain('http://');
    });
  });

  describe('rate limiting', () => {
    it('rejects after 10 requests in the window', async () => {
      const fetchMock = vi.fn().mockImplementation(
        () => Promise.resolve(new Response(htmlPage('x', 'y'), {status: 200})),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx();

      // 10 allowed
      for (let i = 0; i < 10; i++) {
        const r = await runTool(ctx, {url: 'https://ratelimit.test/path'});
        expect(r.status).toBe('ok');
      }

      // 11th hits the limit
      const eleventh = await runTool(ctx, {url: 'https://ratelimit.test/other'});
      expect(eleventh.status).toBe('error');
      expect(eleventh.content).toContain('Rate limited');
      expect(eleventh.content).toContain('ratelimit.test');
    });

    it('limits per-hostname independently', async () => {
      const fetchMock = vi.fn().mockImplementation(
        () => Promise.resolve(new Response(htmlPage('x', 'y'), {status: 200})),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx();

      for (let i = 0; i < 10; i++) {
        await runTool(ctx, {url: 'https://host-a.example/'});
      }
      const blocked = await runTool(ctx, {url: 'https://host-a.example/more'});
      expect(blocked.status).toBe('error');

      // Different host is still OK
      const ok = await runTool(ctx, {url: 'https://host-b.example/'});
      expect(ok.status).toBe('ok');
    });
  });

  describe('DOM-based fallback extraction (Readability fails)', () => {
    // When Readability returns nothing (pages too sparse/malformed), the
    // tool falls back to walking the parsed DOM with linkedom. Verify
    // script/style content does NOT leak into the output.
    it('strips script and style content from DOM-fallback output', async () => {
      const hostile = `<!doctype html><html><head>
        <script>alert("xss-from-head")</script>
        <style>body { color: red; }</style>
      </head><body>
        <script>alert("xss-from-body")</script>
        <p>visible content</p>
        <style>.x{display:none}</style>
      </body></html>`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(hostile, {status: 200})),
      );
      const ctx = makeCtx();
      const result = await runTool(ctx, {url: 'https://example.com'});
      expect(result.status).toBe('ok');
      expect(result.content).toContain('visible content');
      // Script/style content should NOT appear
      expect(result.content).not.toContain('xss-from-head');
      expect(result.content).not.toContain('xss-from-body');
      expect(result.content).not.toContain('display:none');
      expect(result.content).not.toContain('color: red');
    });

    it('handles malformed script closing tags', async () => {
      // </script > with trailing space was the CodeQL-flagged regex miss
      const malformed = `<!doctype html><html><body>
        <script >alert("evil")</script >
        <script type="text/plain">alert("sneaky")</script foo="bar">
        <p>real text</p>
      </body></html>`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(malformed, {status: 200})),
      );
      const ctx = makeCtx();
      const result = await runTool(ctx, {url: 'https://example.com'});
      expect(result.status).toBe('ok');
      expect(result.content).not.toContain('alert(');
      expect(result.content).not.toContain('evil');
      expect(result.content).not.toContain('sneaky');
    });
  });

  describe('result truncation', () => {
    it('truncates long provider output', async () => {
      const huge = 'x'.repeat(50_000);
      const provider = makeProvider({text: huge, retrievedUrls: ['https://example.com']});
      const ctx = makeCtx({searchProvider: provider});

      const result = await runTool(ctx, {url: 'https://example.com'});

      expect(result.status).toBe('ok');
      expect(result.content.length).toBeLessThan(9_000);
      expect(result.content).toContain('(truncated)');
    });
  });
});
