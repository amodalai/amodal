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

// Use a real key from the environment. Tests skip if unavailable.
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY'];
const OPENAI_KEY = process.env['OPENAI_API_KEY'];

const hasAnyKey = Boolean(ANTHROPIC_KEY ?? OPENAI_KEY);

// ---------------------------------------------------------------------------
// Unit tests (no API calls — test construction and error shaping)
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

describe.skipIf(!hasAnyKey)('createFailoverProvider (integration)', () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  // ── 1. Primary fails (invalid key) + fallback succeeds ────────────────

  it('uses fallback when primary has invalid API key', async () => {
    // Use whichever real key we have as the fallback
    const fallbackConfig = ANTHROPIC_KEY
      ? {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: ANTHROPIC_KEY}
      : {provider: 'openai', model: 'gpt-4o-mini', apiKey: OPENAI_KEY!};

    const provider = createFailoverProvider({
      // Primary will fail — invalid key
      primary: {provider: fallbackConfig.provider, model: fallbackConfig.model, apiKey: 'sk-invalid-key-00000'},
      fallbacks: [fallbackConfig],
      logger,
      sessionId: 'test-failover',
    });

    const result = await provider.generateText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: pong'}]}],
      maxOutputTokens: 10,
    });

    // Response should come from fallback
    expect(result.text.toLowerCase()).toContain('pong');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);

    // Verify logging
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({
        session: 'test-failover',
        willRetry: true,
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'provider_failover_used',
      expect.objectContaining({
        succeeded: `${fallbackConfig.provider}/${fallbackConfig.model}`,
      }),
    );
  }, 30000);

  // ── 2. Valid primary → uses primary, no fallback ──────────────────────

  it('uses primary when it succeeds — fallback not touched', async () => {
    const primaryConfig = ANTHROPIC_KEY
      ? {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: ANTHROPIC_KEY}
      : {provider: 'openai', model: 'gpt-4o-mini', apiKey: OPENAI_KEY!};

    const provider = createFailoverProvider({
      primary: primaryConfig,
      fallbacks: [
        // Fallback has invalid key — would fail if reached
        {provider: primaryConfig.provider, model: primaryConfig.model, apiKey: 'sk-invalid-key-00000'},
      ],
      logger,
    });

    const result = await provider.generateText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: ping'}]}],
      maxOutputTokens: 10,
    });

    expect(result.text.toLowerCase()).toContain('ping');

    // No errors logged — primary succeeded on first try
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  }, 30000);

  // ── 3. All providers fail → ProviderError with all attempts ───────────

  it('throws ProviderError with context about all failed attempts', async () => {
    const provider = createFailoverProvider({
      primary: {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'sk-invalid-1'},
      fallbacks: [
        {provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-invalid-2'},
      ],
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

      // Context should have both attempts
      const attempts = pe.context['attempts'] as Array<{provider: string; model: string; error: string}>;
      expect(attempts).toHaveLength(2);
      expect(attempts[0].provider).toBe('anthropic');
      expect(attempts[0].model).toBe('claude-haiku-4-5-20251001');
      expect(attempts[1].provider).toBe('openai');
      expect(attempts[1].model).toBe('gpt-4o-mini');
    }

    // Both failures logged
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({
        session: 'test-all-fail',
        provider: 'anthropic/claude-haiku-4-5-20251001',
        willRetry: true,
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({
        provider: 'openai/gpt-4o-mini',
        willRetry: false,
      }),
    );
  }, 30000);

  // ── 4. Streaming failover ─────────────────────────────────────────────

  it('streaming: uses fallback when primary stream fails', async () => {
    const fallbackConfig = ANTHROPIC_KEY
      ? {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: ANTHROPIC_KEY}
      : {provider: 'openai', model: 'gpt-4o-mini', apiKey: OPENAI_KEY!};

    const provider = createFailoverProvider({
      primary: {provider: fallbackConfig.provider, model: fallbackConfig.model, apiKey: 'sk-invalid-key-00000'},
      fallbacks: [fallbackConfig],
      logger,
    });

    const result = provider.streamText({
      messages: [{role: 'user', content: [{type: 'text', text: 'Reply with exactly: stream-ok'}]}],
      maxOutputTokens: 10,
    });

    // Collect events from the stream
    const events = [];
    for await (const event of result.fullStream) {
      events.push(event);
    }

    // Should have text deltas and a finish event
    const textDeltas = events.filter((e) => e.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);

    const text = await result.text;
    expect(text.toLowerCase()).toContain('stream');

    const usage = await result.usage;
    expect(usage.inputTokens).toBeGreaterThan(0);

    // Failover logging
    expect(logger.error).toHaveBeenCalledWith(
      'provider_call_failed',
      expect.objectContaining({willRetry: true}),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'provider_failover_used',
      expect.objectContaining({
        succeeded: `${fallbackConfig.provider}/${fallbackConfig.model}`,
      }),
    );
  }, 30000);
});
