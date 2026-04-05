/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for the agent loop against real LLM providers.
 * Exercises:
 *
 *   - Token budget enforcement — the loop terminates with
 *     DoneReason='budget_exceeded' when cumulative tokens hit maxTokens.
 *   - Summarizer hook — context eviction invokes summarizeToolResult
 *     and the generated summary flows into subsequent prompts.
 *
 * Parameterized over multiple providers. Select which to run via the
 * E2E_TARGETS env var (comma-separated); defaults to `google`
 * (gemini-2.5-flash) as the cheapest base model. Targets missing an
 * API key auto-skip.
 *
 *   E2E_TARGETS=google                   # base (default)
 *   E2E_TARGETS=anthropic                # single provider
 *   E2E_TARGETS=google,anthropic,openai,groq   # all
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import type {ModelMessage} from 'ai';
import {StandaloneSessionManager} from '../session/manager.js';
import {PGLiteSessionStore} from '../session/store.js';
import {createProvider} from '../providers/create-provider.js';
import {createToolRegistry} from '../tools/registry.js';
import {createLogger} from '../logger.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import type {ToolRegistry, ToolDefinition} from '../tools/types.js';

// Load API keys from repo root .env.test if not already set.
try {
  const envPath = resolve(__dirname, '../../../../.env.test');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (key && value && !process.env[key.trim()]) {
        process.env[key.trim()] = value.trim();
      }
    }
  }
} catch { /* no .env.test — tests will skip */ }

const logger = createLogger({component: 'test:e2e'});

// ---------------------------------------------------------------------------
// Provider targets
// ---------------------------------------------------------------------------

interface E2ETarget {
  provider: string;
  model: string;
  apiKeyEnv: string;
}

const TARGETS: Record<string, E2ETarget> = {
  google: {provider: 'google', model: 'gemini-2.5-flash', apiKeyEnv: 'GOOGLE_API_KEY'},
  anthropic: {provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKeyEnv: 'ANTHROPIC_API_KEY'},
  openai: {provider: 'openai', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY'},
  groq: {provider: 'groq', model: 'llama-3.3-70b-versatile', apiKeyEnv: 'GROQ_API_KEY'},
};

// Default to the "base" model (cheapest, fastest) unless caller overrides.
const selected = (process.env['E2E_TARGETS'] ?? 'google')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const activeTargets: Array<[string, E2ETarget]> = selected
  .map((name): [string, E2ETarget | undefined] => [name, TARGETS[name]])
  .filter((entry): entry is [string, E2ETarget] => {
    const [name, cfg] = entry;
    if (!cfg) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e] unknown target "${name}" — skipped. Known: ${Object.keys(TARGETS).join(', ')}`);
      return false;
    }
    if (!process.env[cfg.apiKeyEnv]) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e] ${name}: ${cfg.apiKeyEnv} not set — skipped`);
      return false;
    }
    return true;
  });

const allowAll: PermissionChecker = {
  check: () => ({allowed: true as const}),
};

/** Echo tool — returns a plain string so the model sees a clear result. */
function makeEchoTool(): ToolDefinition<{value: string}> {
  return {
    description: 'Echoes back the input value. Use this whenever the user asks you to echo something.',
    parameters: z.object({value: z.string()}),
    execute: (params) => Promise.resolve(`echoed: ${params.value}`),
    readOnly: true,
    metadata: {category: 'custom'},
  };
}

function buildRegistry(): ToolRegistry {
  const registry = createToolRegistry();
  registry.register('echo_tool', makeEchoTool());
  return registry;
}

describe.skipIf(activeTargets.length === 0)('e2e', () => {
  let store: PGLiteSessionStore;
  let mgr: StandaloneSessionManager;

  beforeAll(async () => {
    store = new PGLiteSessionStore({logger});
    await store.initialize();
    mgr = new StandaloneSessionManager({logger, store});
    mgr.start();
  });

  afterAll(async () => {
    await mgr.shutdown();
    await store.close();
  });

  describe.each(activeTargets)('[%s]', (_name, target) => {
  it('terminates with budget_exceeded when maxTokens cap is hit', async () => {
    const provider = createProvider({
      provider: target.provider,
      model: target.model,

      apiKey: process.env[target.apiKeyEnv]!,
    });

    // Tiny budget — any first-turn input+output will blow past this,
    // causing budget_exceeded to fire on the next outer-loop check.
    // Small enough that every provider trips regardless of how terse
    // the model chooses to be.
    const MAX_TOKENS = 200;
    const session = mgr.create({
      tenantId: 'e2e-tenant',
      userId: 'e2e-user',
      provider,
      toolRegistry: buildRegistry(),
      permissionChecker: allowAll,
      systemPrompt: 'You are a terse assistant. Use the echo_tool when asked.',
      maxTurns: 10,
      maxTokens: MAX_TOKENS,
    });

    const events: SSEEvent[] = [];
    for await (const event of mgr.runMessage(
      session.id,
      'Echo these strings one at a time: alpha, bravo, charlie, delta, echo, foxtrot. Use echo_tool for each.',
      {signal: AbortSignal.timeout(60_000)},
    )) {
      events.push(event);
    }

    const done = events.find((e) => e.type === SSEEventType.Done);
    expect(done).toBeDefined();
    if (done && done.type === SSEEventType.Done) {
      expect(done.reason).toBe('budget_exceeded');
      expect(done.usage?.total_tokens ?? 0).toBeGreaterThanOrEqual(MAX_TOKENS);
    }
  }, 90_000);

  it('invokes summarizeToolResult hook when context is evicted', async () => {
    const provider = createProvider({
      provider: target.provider,
      model: target.model,

      apiKey: process.env[target.apiKeyEnv]!,
    });

    // Seed 20 tool-result messages so the default clearThreshold=15 fires
    // on the very first turn. Messages are in pairs: an assistant tool-call
    // followed by the tool result, matching the real shape. An initial
    // user message is required to satisfy Anthropic's message-sequence
    // validation (conversations must begin with user).
    const seeded: ModelMessage[] = [
      {role: 'user', content: 'Please echo some seed values for me.'} as ModelMessage,
    ];
    for (let i = 0; i < 20; i++) {
      seeded.push({
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: `c${i}`,
          toolName: 'echo_tool',
          input: {value: `seed-${i}`},
        }],
      } as ModelMessage);
      seeded.push({
        role: 'tool',
        content: [{
          type: 'tool-result' as const,
          toolCallId: `c${i}`,
          toolName: 'echo_tool',
          output: {type: 'text' as const, value: `echoed: seed-${i} with more text to make this a non-trivial result body`},
        }],
      } as ModelMessage);
    }

    const session = mgr.create({
      tenantId: 'e2e-tenant',
      userId: 'e2e-user',
      provider,
      toolRegistry: buildRegistry(),
      permissionChecker: allowAll,
      systemPrompt: 'You are a terse assistant. Answer in one short sentence.',
      maxTurns: 2,
      messages: seeded,
    });

    // Recording summarizer — captures calls to verify hook plumbing.
    const summarizerCalls: Array<{toolName: string; content: string; hasSignal: boolean}> = [];
    const summarizer = (opts: {toolName: string; content: string; signal: AbortSignal}): Promise<string> => {
      summarizerCalls.push({
        toolName: opts.toolName,
        content: opts.content,
        hasSignal: opts.signal instanceof AbortSignal,
      });
      return Promise.resolve('3 items echoed');
    };

    const events: SSEEvent[] = [];
    for await (const event of mgr.runMessage(
      session.id,
      'Briefly say "done".',
      {
        signal: AbortSignal.timeout(60_000),
        summarizeToolResult: summarizer,
      },
    )) {
      events.push(event);
    }

    // clearThreshold=15, keepRecent=5 → 15 messages should be cleared and
    // the summarizer should be called for each (none are pre-cleared).
    expect(summarizerCalls.length).toBe(15);

    // Every call should have received a real AbortSignal
    for (const call of summarizerCalls) {
      expect(call.hasSignal).toBe(true);
      expect(call.toolName).toBe('echo_tool');
      expect(call.content).toContain('echoed:');
    }

    // The session should have terminated normally (model responded)
    const done = events.find((e) => e.type === SSEEventType.Done);
    expect(done).toBeDefined();

    // Session messages should now contain the summary marker in the cleared positions
    const clearedWithSummary = session.messages.filter((msg) =>
      msg.role === 'tool' &&
      Array.isArray(msg.content) &&
      msg.content.some((part) =>
        'output' in part &&
        part.output &&
        typeof part.output === 'object' &&
        'value' in part.output &&
        typeof part.output.value === 'string' &&
        part.output.value.includes('3 items echoed'),
      ),
    );
    expect(clearedWithSummary.length).toBe(15);
  }, 90_000);
  });
});
