/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for Phase 3 deferred features, against a real
 * Anthropic provider. Exercises:
 *
 *   (a) Token budget enforcement — the loop terminates with
 *       DoneReason='budget_exceeded' when cumulative tokens hit maxTokens.
 *   (c) Summarizer hook — context eviction invokes summarizeToolResult
 *       and the generated summary flows into subsequent prompts.
 *
 * Uses claude-haiku-4-5 to keep per-run cost tiny (< $0.02). Auto-skips
 * when ANTHROPIC_API_KEY is not set.
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
if (!process.env['ANTHROPIC_API_KEY']) {
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
}

const skipReason = process.env['ANTHROPIC_API_KEY'] ? '' : 'ANTHROPIC_API_KEY not set';

const logger = createLogger({component: 'test:phase3-e2e'});

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

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

describe.skipIf(!!skipReason)('phase 3 e2e (real Anthropic Haiku)', () => {
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

  it('terminates with budget_exceeded when maxTokens cap is hit', async () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: HAIKU_MODEL,
       
      apiKey: process.env['ANTHROPIC_API_KEY']!,
    });

    // Tiny budget — the first turn's input tokens alone will blow past this,
    // causing budget_exceeded to fire on the next outer-loop check.
    const session = mgr.create({
      tenantId: 'e2e-tenant',
      userId: 'e2e-user',
      provider,
      toolRegistry: buildRegistry(),
      permissionChecker: allowAll,
      systemPrompt: 'You are a terse assistant. Use the echo_tool when asked.',
      maxTurns: 10,
      maxTokens: 500,
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
      // Actual termination reason isn't on the SSE Done event (the event
      // only carries usage), but session usage should match the cap.
      expect(done.usage?.total_tokens).toBeGreaterThanOrEqual(500);
    }

    // The session's accumulated usage should reflect the cap being hit
    expect(session.usage.totalTokens).toBeGreaterThanOrEqual(500);

    // Session should not have completed all 6 echo calls — budget capped it
    const toolCalls = events.filter((e) => e.type === SSEEventType.ToolCallStart);
    expect(toolCalls.length).toBeLessThan(6);
  }, 90_000);

  it('invokes summarizeToolResult hook when context is evicted', async () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: HAIKU_MODEL,
       
      apiKey: process.env['ANTHROPIC_API_KEY']!,
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
