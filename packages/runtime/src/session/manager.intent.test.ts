/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 2 hook test — verifies `runMessage` short-circuits past the
 * agent loop when an intent matches, and falls through to the LLM
 * when it doesn't. Doesn't require a database; uses the in-memory
 * SessionManager + a stub provider that throws if the LLM gets
 * invoked (so a leaked agent-loop call fails the test).
 */

import {describe, it, expect} from 'vitest';
import {z} from 'zod';
import type {IntentDefinition} from '@amodalai/types';
import {StandaloneSessionManager} from './manager.js';
import type {CreateSessionOptions} from './types.js';
import type {LLMProvider, StreamEvent, StreamTextResult, TokenUsage} from '../providers/types.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import {createLogger} from '../logger.js';
import {createToolRegistry} from '../tools/registry.js';
import type {ToolDefinition} from '../tools/types.js';

const logger = createLogger({component: 'test:manager-intent'});

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Provider that records whether streamText was called. Pass-through
 *  text response when invoked so fall-through paths still produce a
 *  valid SSE stream. */
function recordingProvider(): LLMProvider & {streamTextCalled: () => number} {
  let calls = 0;
  return {
    model: 'test-model',
    provider: 'test-provider',
    languageModel: {} as LLMProvider['languageModel'],
    streamText(): StreamTextResult {
      calls++;
      const usage: TokenUsage = {inputTokens: 1, outputTokens: 1, totalTokens: 2};
      const events: StreamEvent[] = [
        {type: 'text-delta', textDelta: 'fallthrough text'},
        {type: 'finish', usage},
      ];
      async function* fullStream() {
        for (const e of events) yield e;
      }
      async function* textStream() {
        yield 'fallthrough text';
      }
      return {
        fullStream: fullStream(),
        textStream: textStream(),
        usage: Promise.resolve(usage),
        text: Promise.resolve('fallthrough text'),
        responseMessages: Promise.resolve([{role: 'assistant', content: 'fallthrough text'}]),
      };
    },
    generateText: () => Promise.reject(new Error('not used')),
    streamTextCalled: () => calls,
  };
}

function permissive(): PermissionChecker {
  return {check: () => ({allowed: true as const})};
}

function makeOpts(intents: IntentDefinition[], provider: LLMProvider): CreateSessionOptions {
  const reg = createToolRegistry();
  const echoTool: ToolDefinition = {
    description: 'echo',
    parameters: z.object({slug: z.string()}),
    readOnly: true,
    runningLabel: "Echoing '{{slug}}'",
    completedLabel: "Echoed '{{slug}}'",
    execute: async (params: unknown) => ({echoed: (params as {slug: string}).slug}),
  };
  reg.register('echo', echoTool);

  return {
    provider,
    toolRegistry: reg,
    permissionChecker: permissive(),
    systemPrompt: 'test',
    intents,
  };
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager.runMessage — intent routing', () => {
  it('runs the matched intent and skips the LLM entirely', async () => {
    const installIntent: IntentDefinition = {
      id: 'install',
      regex: /^Set up template '(.+)'\.?$/,
      handle: async (ctx) => {
        await ctx.callTool('echo', {slug: ctx.match[1]});
        return {};
      },
    };

    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([installIntent], provider));

    const events = await collect(
      mgr.runMessage(session.id, "Set up template 'marketing-digest'."),
    );

    // LLM not invoked.
    expect(provider.streamTextCalled()).toBe(0);

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      SSEEventType.ToolCallStart,
      SSEEventType.ToolCallResult,
      SSEEventType.Done,
    ]);

    // Tool call's params carry the captured slug.
    const start = events[0] as Extract<SSEEvent, {type: SSEEventType.ToolCallStart}>;
    expect(start.tool_name).toBe('echo');
    expect(start.parameters['slug']).toBe('marketing-digest');

    // session.messages has user + synthetic assistant + tool result.
    const stored = mgr.get(session.id)?.messages ?? [];
    expect(stored).toHaveLength(3);
    expect(stored[0].role).toBe('user');
    expect(stored[1].role).toBe('assistant');
    expect(stored[2].role).toBe('tool');
  });

  it('falls through to the LLM when no intent matches', async () => {
    const noMatchIntent: IntentDefinition = {
      id: 'never',
      regex: /^never going to match$/,
      handle: async () => null,
    };

    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([noMatchIntent], provider));

    await collect(mgr.runMessage(session.id, 'something completely different'));

    expect(provider.streamTextCalled()).toBe(1);
  });

  it('falls through to the LLM when handler returns null pre-commit', async () => {
    const precheckIntent: IntentDefinition = {
      id: 'precheck',
      regex: /^run$/,
      handle: async () => null, // bail before any tool call
    };

    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([precheckIntent], provider));

    await collect(mgr.runMessage(session.id, 'run'));

    expect(provider.streamTextCalled()).toBe(1);
  });

  it('skips intent routing for multimodal (image-bearing) turns', async () => {
    const wouldMatchIntent: IntentDefinition = {
      id: 'wouldmatch',
      regex: /^describe$/,
      handle: async () => {
        throw new Error('intent should not have run for image turn');
      },
    };

    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([wouldMatchIntent], provider));

    // Anthropic supports vision, so images flow through to the LLM.
    Object.assign(session, {providerName: 'anthropic'});

    await collect(
      mgr.runMessage(session.id, 'describe', {
        images: [{mimeType: 'image/png', data: 'iVBORw0KGgo='}],
      }),
    );

    // LLM was called (image turn bypasses intents) and intent didn't run.
    expect(provider.streamTextCalled()).toBe(1);
  });

  it('agents with no intents behave exactly like before', async () => {
    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([], provider));

    await collect(mgr.runMessage(session.id, 'hello'));

    expect(provider.streamTextCalled()).toBe(1);
  });

  it('intent returning {continue: true} runs tools AND invokes the LLM with the new state', async () => {
    const continueIntent: IntentDefinition = {
      id: 'half-deterministic',
      regex: /^do half$/,
      handle: async (ctx) => {
        await ctx.callTool('echo', {slug: 'half'});
        return {continue: true};
      },
    };

    const provider = recordingProvider();
    const mgr = new StandaloneSessionManager({logger});
    const session = mgr.create(makeOpts([continueIntent], provider));

    await collect(mgr.runMessage(session.id, 'do half'));

    // LLM was invoked exactly once, after the intent's tool ran.
    expect(provider.streamTextCalled()).toBe(1);

    // Stored messages: user, assistant (intent's tool call), tool
    // (intent's tool result), assistant (LLM's response).
    const stored = mgr.get(session.id)?.messages ?? [];
    expect(stored.length).toBeGreaterThanOrEqual(4);
    expect(stored[0].role).toBe('user');
    expect(stored[1].role).toBe('assistant'); // intent
    expect(stored[2].role).toBe('tool'); // intent's tool result
    expect(stored[3].role).toBe('assistant'); // LLM continuation
  });
});
