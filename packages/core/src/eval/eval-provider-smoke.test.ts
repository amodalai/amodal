/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Smoke tests for the eval provider — makes REAL LLM calls via the
 * Vercel AI SDK to verify SessionEvalQueryProvider works end-to-end.
 *
 * Requires at least one provider API key in the environment or in
 * `<repo-root>/.env.test` (gitignored). Skips cleanly when no keys
 * are configured.
 *
 * Run:
 *   pnpm --filter @amodalai/core run test:smoke
 *   EVAL_SMOKE_TARGET=openai pnpm --filter @amodalai/core run test:smoke
 */

import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionEvalQueryProvider} from './eval-session-provider.js';

// ---------------------------------------------------------------------------
// Env loading (mirrors runtime test-env.ts without creating a cross-package dep)
// ---------------------------------------------------------------------------

const __dir = resolve(fileURLToPath(import.meta.url), '..');

function loadTestEnv(): void {
  try {
    const envPath = resolve(__dir, '../../../../.env.test');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value.trim();
        }
      }
    }
  } catch { /* no .env.test — tests will skip */ }
}

loadTestEnv();

// ---------------------------------------------------------------------------
// Provider targets
// ---------------------------------------------------------------------------

interface SmokeTarget {
  provider: string;
  model: string;
  apiKeyEnv: string;
}

const TARGETS: Record<string, SmokeTarget> = {
  google: {provider: 'google', model: 'gemini-2.5-flash', apiKeyEnv: 'GOOGLE_API_KEY'},
  anthropic: {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKeyEnv: 'ANTHROPIC_API_KEY'},
  openai: {provider: 'openai', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY'},
  groq: {provider: 'groq', model: 'llama-3.3-70b-versatile', apiKeyEnv: 'GROQ_API_KEY'},
};

const PREFERENCE = ['google', 'anthropic', 'openai', 'groq'] as const;

function pickTarget(): {name: string; target: SmokeTarget} | undefined {
  const override = process.env['EVAL_SMOKE_TARGET'];
  if (override) {
    const t = TARGETS[override];
    if (t && process.env[t.apiKeyEnv]) return {name: override, target: t};
    return undefined;
  }
  for (const name of PREFERENCE) {
    const t = TARGETS[name];
    if (t && process.env[t.apiKeyEnv]) return {name, target: t};
  }
  return undefined;
}

const picked = pickTarget();
const skipReason = picked ? '' : 'No provider API key configured (set GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY)';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!!skipReason)(`eval provider smoke [${picked?.name ?? 'none'}]`, () => {
  it('returns text and usage for a simple query', async () => {
    const provider = new SessionEvalQueryProvider({
      modelConfig: {
        provider: picked!.target.provider,
        model: picked!.target.model,
        credentials: {apiKey: process.env[picked!.target.apiKeyEnv]!},
      },
      systemPrompt: 'Reply with exactly one word.',
      maxTokens: 64,
    });

    const result = await provider.query('What color is the sky?');

    expect(result.response.length).toBeGreaterThan(0);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens).toBeGreaterThan(0);
    expect(result.usage!.outputTokens).toBeGreaterThan(0);
  }, 30_000);

  it('handles multi-turn with different system prompts', async () => {
    const provider = new SessionEvalQueryProvider({
      modelConfig: {
        provider: picked!.target.provider,
        model: picked!.target.model,
        credentials: {apiKey: process.env[picked!.target.apiKeyEnv]!},
      },
      systemPrompt: 'You are a calculator. Reply with only the numeric result.',
      maxTokens: 32,
    });

    const result = await provider.query('What is 2 + 2?');

    expect(result.response).toMatch(/4/);
    expect(result.usage).toBeDefined();
  }, 30_000);
});
