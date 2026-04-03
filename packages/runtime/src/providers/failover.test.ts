/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 1.4 — Provider Failover Tests
 *
 * Integration tests against real providers (skipped when API keys are
 * not available). No mocks — calls the real AI SDK through the real
 * createProvider → createFailoverProvider chain.
 *
 * Scenarios from the SDK swap plan:
 * 1. Primary with invalid key + fallback with valid key → response from fallback
 * 2. Valid primary → uses primary, no fallback
 * 3. All providers fail → throws ProviderError with context about all attempts
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createFailoverProvider} from './failover.js';
import {ProviderError} from '../errors.js';
import {testProviders, hasAnyProvider} from '../__tests__/test-providers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ---------------------------------------------------------------------------
// Unit tests (no API calls)
// ---------------------------------------------------------------------------

describe('createFailoverProvider (unit)', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it('exposes primary model and provider on the returned object', () => {
    const provider = createFailoverProvider({
      primary: {provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'fake'},
      fallbacks: [{provider: 'openai', model: 'gpt-4o', apiKey: 'fake'}],
      logger,
    });

    expect(provider.model).toBe('claude-sonnet-4-20250514');
    expect(provider.provider).toBe('anthropic');
    expect(provider.languageModel).toBeDefined();
    expect(typeof provider.streamText).toBe('function');
    expect(typeof provider.generateText).toBe('function');
  });

  it('works with a single provider (no fallbacks)', () => {
    const provider = createFailoverProvider({
      primary: {provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'fake'},
      logger,
    });

    expect(provider.model).toBe('claude-sonnet-4-20250514');
  });
});

// ---------------------------------------------------------------------------
// Integration tests (real API calls — skipped without keys)
// ---------------------------------------------------------------------------

describe.skipIf(!hasAnyProvider)('createFailoverProvider (integration)', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  // ── 1. Primary fails (invalid key) + fallback succeeds ────────────────

  it('uses fallback when primary has invalid API key', async () => {
    const fallback = testProviders.cheapest()!;
    const invalid = testProviders.invalid(fallback.provider);

    const provider = createFailoverProvider({
      primary: invalid,
      fallbacks: [fallback],
      logger,
      sessionId: 'test-failover',
    });

    const result = await provider.generateText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: pong'}]}],
      maxOutputTokens: 10,
    });

    expect(result.text.toLowerCase()).toContain('pong');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);

    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({session: 'test-failover', willRetry: true}),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'provider_failover_used',
      expect.objectContaining({
        succeeded: `${fallback.provider}/${fallback.model}`,
      }),
    );
  }, 30000);

  // ── 2. Valid primary → uses primary, no fallback ──────────────────────

  it('uses primary when it succeeds — fallback not touched', async () => {
    const primary = testProviders.cheapest()!;

    const provider = createFailoverProvider({
      primary,
      // Fallback has invalid key — would fail if reached
      fallbacks: [testProviders.invalid(primary.provider)],
      logger,
    });

    const result = await provider.generateText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: ping'}]}],
      maxOutputTokens: 10,
    });

    expect(result.text.toLowerCase()).toContain('ping');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  }, 30000);

  // ── 3. All providers fail → ProviderError with all attempts ───────────

  it('throws ProviderError with context about all failed attempts', async () => {
    const provider = createFailoverProvider({
      primary: testProviders.invalid('anthropic'),
      fallbacks: [testProviders.invalid('openai')],
      logger,
      sessionId: 'test-all-fail',
    });

    try {
      await provider.generateText({
        messages: [{role: 'user', content: [{type: 'text', text: 'hello'}]}],
        maxOutputTokens: 10,
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.message).toBe('All providers failed');
      expect(pe.provider).toBe('failover');

      const attempts = pe.context['attempts'] as Array<{provider: string; model: string; error: string}>;
      expect(attempts).toHaveLength(2);
      expect(attempts[0].provider).toBe('anthropic');
      expect(attempts[1].provider).toBe('openai');
    }

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({session: 'test-all-fail', willRetry: true}),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({willRetry: false}),
    );
  }, 30000);

  // ── 4. Streaming failover ─────────────────────────────────────────────

  it('streaming: uses fallback when primary stream fails', async () => {
    const fallback = testProviders.cheapest()!;
    const invalid = testProviders.invalid(fallback.provider);

    const provider = createFailoverProvider({
      primary: invalid,
      fallbacks: [fallback],
      logger,
    });

    const result = provider.streamText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: stream-ok'}]}],
      maxOutputTokens: 10,
    });

    const events = [];
    for await (const event of result.fullStream) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);

    const text = await result.text;
    expect(text.length).toBeGreaterThan(0);

    const usage = await result.usage;
    expect(usage.inputTokens).toBeGreaterThan(0);

    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({willRetry: true}),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'provider_failover_used',
      expect.objectContaining({
        succeeded: `${fallback.provider}/${fallback.model}`,
      }),
    );
  }, 30000);
});
