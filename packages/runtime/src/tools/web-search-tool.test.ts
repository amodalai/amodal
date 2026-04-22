/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it, vi} from 'vitest';
import {createWebSearchTool} from './web-search-tool.js';
import {ProviderError} from '../errors.js';
import type {SearchProvider, SearchResult} from '../providers/search-provider.js';
import type {ToolContext} from './types.js';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    request: vi.fn(),
    store: vi.fn(),
    env: vi.fn(),
    log: vi.fn(),
    signal: AbortSignal.timeout(5000),
    sessionId: 'test-session',
    scopeId: '',
    ...overrides,
  };
}

function makeProvider(result: SearchResult): SearchProvider {
  return {
    model: 'gemini-2.5-flash',
    search: vi.fn().mockResolvedValue(result),
    fetchUrl: vi.fn(),
  };
}

// Helper to execute the tool and get a typed result.
async function runTool(ctx: ToolContext, params: {query: string; max_results?: number}): Promise<{
  status: string;
  content: string;
  source_count?: number;
}> {
  const tool = createWebSearchTool();
  const raw = await tool.execute(params, ctx);
  return raw as {status: string; content: string; source_count?: number};
}

describe('web_search tool', () => {
  it('returns a friendly error when no searchProvider is configured', async () => {
    const ctx = makeCtx();
    const result = await runTool(ctx, {query: 'anything'});
    expect(result.status).toBe('error');
    expect(result.content).toContain('not configured');
    expect(result.content).toContain('webTools');
  });

  it('formats synthesized answer with numbered source citations', async () => {
    const provider = makeProvider({
      text: 'Node.js 22 is the current LTS.',
      sources: [
        {uri: 'https://nodejs.org/en/blog/release/v22.0.0', title: 'Node.js 22 Release'},
        {uri: 'https://en.wikipedia.org/wiki/Node.js'},
      ],
    });
    const ctx = makeCtx({searchProvider: provider});

    const result = await runTool(ctx, {query: 'latest node version'});

    expect(result.status).toBe('ok');
    expect(result.content).toContain('Node.js 22 is the current LTS.');
    expect(result.content).toContain('[1] https://nodejs.org/en/blog/release/v22.0.0 — Node.js 22 Release');
    expect(result.content).toContain('[2] https://en.wikipedia.org/wiki/Node.js');
    expect(result.source_count).toBe(2);
  });

  it('notes when no sources were returned', async () => {
    const provider = makeProvider({text: 'Answer without sources.', sources: []});
    const ctx = makeCtx({searchProvider: provider});

    const result = await runTool(ctx, {query: 'something'});

    expect(result.status).toBe('ok');
    expect(result.content).toContain('(no sources cited)');
    expect(result.source_count).toBe(0);
  });

  it('caps source list at max_results', async () => {
    const sources = Array.from({length: 8}, (_, i) => ({uri: `https://example.com/${String(i)}`}));
    const provider = makeProvider({text: 'answer', sources});
    const ctx = makeCtx({searchProvider: provider});

    const result = await runTool(ctx, {query: 'q', max_results: 3});

    expect(result.source_count).toBe(3);
    expect(result.content).toContain('[1]');
    expect(result.content).toContain('[3]');
    expect(result.content).not.toContain('[4]');
  });

  it('passes ctx.signal through to the provider', async () => {
    const searchMock = vi.fn().mockResolvedValue({text: 'x', sources: []});
    const provider: SearchProvider = {
      model: 'test',
      search: searchMock,
      fetchUrl: vi.fn(),
    };
    const signal = AbortSignal.timeout(1000);
    const ctx = makeCtx({searchProvider: provider, signal});

    await runTool(ctx, {query: 'q'});

    expect(searchMock).toHaveBeenCalledWith('q', {signal});
  });

  it('truncates very long output with a marker', async () => {
    const huge = 'a'.repeat(50_000);
    const provider = makeProvider({text: huge, sources: []});
    const ctx = makeCtx({searchProvider: provider});

    const result = await runTool(ctx, {query: 'q'});

    expect(result.status).toBe('ok');
    expect(result.content.length).toBeLessThan(9_000); // 2000 tokens × 4 chars/token = 8000
    expect(result.content).toContain('(truncated)');
  });

  describe('provider error classification (retry guidance)', () => {
    function makeProviderErrorProvider(status: number): SearchProvider {
      const err = new ProviderError('Grounded search failed', {
        provider: 'google',
        statusCode: status,
        retryable: status >= 500,
      });
      return {
        model: 'test',
        search: vi.fn().mockRejectedValue(err),
        fetchUrl: vi.fn(),
      };
    }

    it('tells the agent NOT to retry on 401 (auth)', async () => {
      const ctx = makeCtx({searchProvider: makeProviderErrorProvider(401)});
      const result = await runTool(ctx, {query: 'q'});
      expect(result.status).toBe('error');
      expect(result.content).toContain('DO NOT retry');
      expect(result.content).toContain('GOOGLE_API_KEY');
      expect((result as {retryable?: boolean}).retryable).toBe(false);
    });

    it('tells the agent NOT to retry on 400 (bad key)', async () => {
      const ctx = makeCtx({searchProvider: makeProviderErrorProvider(400)});
      const result = await runTool(ctx, {query: 'q'});
      expect(result.content).toContain('DO NOT retry');
      expect((result as {retryable?: boolean}).retryable).toBe(false);
    });

    it('tells the agent NOT to retry on 429 (quota)', async () => {
      const ctx = makeCtx({searchProvider: makeProviderErrorProvider(429)});
      const result = await runTool(ctx, {query: 'q'});
      expect(result.content).toContain('rate-limited');
      expect(result.content).toContain('DO NOT retry');
      expect((result as {retryable?: boolean}).retryable).toBe(false);
    });

    it('says retry is OK on 5xx (transient)', async () => {
      const ctx = makeCtx({searchProvider: makeProviderErrorProvider(503)});
      const result = await runTool(ctx, {query: 'q'});
      expect(result.content).toContain('transient');
      expect(result.content).toContain('may retry');
      expect((result as {retryable?: boolean}).retryable).toBe(true);
    });
  });

  it('wraps unexpected (non-ProviderError) errors in ToolExecutionError', async () => {
    const provider: SearchProvider = {
      model: 'test',
      search: vi.fn().mockRejectedValue(new Error('boom')),
      fetchUrl: vi.fn(),
    };
    const ctx = makeCtx({searchProvider: provider});
    const tool = createWebSearchTool();

    await expect(tool.execute({query: 'q'}, ctx)).rejects.toMatchObject({
      name: 'ToolExecutionError',
      toolName: 'web_search',
    });
  });
});
