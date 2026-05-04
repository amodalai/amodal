/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {z} from 'zod';
import type {IntentDefinition, IntentContext} from '@amodalai/types';
import type {ToolDefinition, ToolContext} from '../tools/types.js';
import type {ToolRegistry} from '../tools/types.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import {runIntent} from './executor.js';

// ---------------------------------------------------------------------------
// Test scaffolding — minimal stubs for ToolRegistry and ToolContext
// ---------------------------------------------------------------------------

function makeRegistry(tools: Record<string, ToolDefinition>): ToolRegistry {
  return {
    register: vi.fn(),
    get: (name: string) => tools[name],
    getTools: () => tools,
    names: () => Object.keys(tools),
    subset: (names: string[]) =>
      Object.fromEntries(names.filter((n) => n in tools).map((n) => [n, tools[n]])),
    get size() {
      return Object.keys(tools).length;
    },
  };
}

/** Run regex against a known-matching input. Throws if it doesn't,
 *  which only happens if the test author wrote a wrong fixture. */
function execMatch(re: RegExp, input: string): RegExpExecArray {
  re.lastIndex = 0;
  const m = re.exec(input);
  if (!m) throw new Error(`fixture regex did not match: ${re.source} on "${input}"`);
  return m;
}

/** Build a fresh ToolContext for each test invocation. The `emit`
 *  fn captures inline events via the closure-bound `inlineEvents`
 *  array — keeps the helper tiny and side-effect-isolated. */
function freshToolContext(): ToolContext {
  const inlineEvents: ToolContext['inlineEvents'] = [];
  return {
    request: () => Promise.reject(new Error('not used')),
    store: () => Promise.reject(new Error('not used')),
    env: () => undefined,
    log: () => undefined,
    inlineEvents,
    emit(event) {
      inlineEvents?.push(event);
    },
    signal: AbortSignal.timeout(60_000),
    sessionId: 'test-session',
    scopeId: '',
  };
}

const silentLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// ---------------------------------------------------------------------------
// Helper: drain the generator and split events from outcome
// ---------------------------------------------------------------------------

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{events: T[]; outcome: R}> {
  const events: T[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) {
      return {events, outcome: next.value};
    }
    events.push(next.value);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runIntent', () => {
  it('runs a single tool, emits start+result, returns completion outcome', async () => {
    const echoTool: ToolDefinition = {
      description: 'echo',
      parameters: z.object({text: z.string()}),
      readOnly: true,
      runningLabel: "Echoing '{{text}}'",
      completedLabel: "Echoed '{{text}}'",
      execute: async (params: unknown) => ({echoed: (params as {text: string}).text}),
    };

    const intent: IntentDefinition = {
      id: 'echo',
      regex: /^echo (.+)$/,
      handle: async (ctx: IntentContext) => {
        const text = ctx.match[1];
        await ctx.callTool('echo', {text});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^echo (.+)$/, 'echo hello')},
        userMessage: 'echo hello',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({echo: echoTool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('completed');

    const eventTypes = result.events.map((e) => e.type);
    expect(eventTypes).toEqual([
      SSEEventType.ToolCallStart,
      SSEEventType.ToolCallResult,
      SSEEventType.Done,
    ]);

    const startEvent = result.events[0] as Extract<SSEEvent, {type: SSEEventType.ToolCallStart}>;
    expect(startEvent.tool_name).toBe('echo');
    expect(startEvent.parameters).toEqual({text: 'hello'});
    expect(startEvent.running_label).toBe("Echoing 'hello'");
    expect(startEvent.completed_label).toBe("Echoed 'hello'");
  });

  it('chains tools: handler awaits result of one to construct params for the next', async () => {
    const calls: Array<{tool: string; params: Record<string, unknown>}> = [];

    const resolveTool: ToolDefinition = {
      description: 'resolve',
      parameters: z.object({slug: z.string()}),
      readOnly: true,
      execute: async (params: unknown) => {
        calls.push({tool: 'resolve', params: params as Record<string, unknown>});
        return {ok: true, displayName: 'Marketing Digest'};
      },
    };
    const persistTool: ToolDefinition = {
      description: 'persist',
      parameters: z.object({name: z.string()}),
      readOnly: false,
      execute: async (params: unknown) => {
        calls.push({tool: 'persist', params: params as Record<string, unknown>});
        return {ok: true};
      },
    };

    const intent: IntentDefinition = {
      id: 'install',
      regex: /^install (.+)$/,
      handle: async (ctx) => {
        const resolved = (await ctx.callTool('resolve', {slug: ctx.match[1]})) as {
          displayName: string;
        };
        await ctx.callTool('persist', {name: resolved.displayName});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {
          intent,
          match: execMatch(/^install (.+)$/, 'install marketing-digest'),
        },
        userMessage: 'install marketing-digest',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({resolve: resolveTool, persist: persistTool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('completed');
    expect(calls).toEqual([
      {tool: 'resolve', params: {slug: 'marketing-digest'}},
      {tool: 'persist', params: {name: 'Marketing Digest'}},
    ]);

    if (result.outcome.kind !== 'completed') throw new Error('expected completed');
    expect(result.outcome.assistantMessage.role).toBe('assistant');
    const content = result.outcome.assistantMessage.content as Array<{type: string; toolName?: string}>;
    expect(content.filter((c) => c.type === 'tool-call').map((c) => c.toolName)).toEqual([
      'resolve',
      'persist',
    ]);
    expect(result.outcome.toolMessages).toHaveLength(2);
  });

  it('falls through when handler returns null before any tool ran', async () => {
    const intent: IntentDefinition = {
      id: 'precheck',
      regex: /^check$/,
      handle: async () => null,
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^check$/, 'check')},
        userMessage: 'check',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('fellThrough');
    expect(result.events).toEqual([]);
  });

  it('refuses to invoke a confirmation-gated tool', async () => {
    const gatedTool: ToolDefinition = {
      description: 'gated',
      parameters: z.object({}),
      readOnly: false,
      requiresConfirmation: true,
      execute: async () => ({ok: true}),
    };

    const intent: IntentDefinition = {
      id: 'try-gated',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('gated', {});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({gated: gatedTool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('errored');
    if (result.outcome.kind !== 'errored') throw new Error('expected errored');
    expect(result.outcome.error.message).toMatch(/confirmation/);
  });

  it('refuses to invoke a connection-category tool', async () => {
    const connTool: ToolDefinition = {
      description: 'connection',
      parameters: z.object({}),
      readOnly: false,
      metadata: {category: 'connection'},
      execute: async () => ({ok: true}),
    };

    const intent: IntentDefinition = {
      id: 'try-conn',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('connection', {});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({connection: connTool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('errored');
  });

  it('rejects invalid params via tool schema', async () => {
    const tool: ToolDefinition = {
      description: 'strict',
      parameters: z.object({slug: z.string().min(3)}),
      readOnly: true,
      execute: async () => ({ok: true}),
    };

    const intent: IntentDefinition = {
      id: 'bad-params',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('strict', {slug: 'x'});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({strict: tool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('errored');
  });

  it('emits inline events from the tool between start and result', async () => {
    const tool: ToolDefinition = {
      description: 'emits',
      parameters: z.object({}),
      readOnly: true,
      execute: async (_params: unknown, ctx: ToolContext) => {
        ctx.emit?.({
          type: SSEEventType.ToolLabelUpdate,
          tool_id: 'unused',
          running_label: 'mid-flight',
          timestamp: new Date().toISOString(),
        });
        return {ok: true};
      },
    };

    const intent: IntentDefinition = {
      id: 'inline',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('emits', {});
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({emits: tool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.events.map((e) => e.type)).toEqual([
      SSEEventType.ToolCallStart,
      SSEEventType.ToolLabelUpdate,
      SSEEventType.ToolCallResult,
      SSEEventType.Done,
    ]);
  });

  it('handler thrown error becomes an error SSE + errored outcome', async () => {
    const intent: IntentDefinition = {
      id: 'crash',
      regex: /^run$/,
      handle: async () => {
        throw new Error('handler exploded');
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    expect(result.outcome.kind).toBe('errored');
    const errorEvent = result.events.find((e) => e.type === SSEEventType.Error);
    expect(errorEvent).toBeDefined();
    expect(
      (errorEvent as Extract<SSEEvent, {type: SSEEventType.Error}>).message,
    ).toBe('handler exploded');
  });

  it('redacts secret-shaped param keys from the SSE wire', async () => {
    const tool: ToolDefinition = {
      description: 'authy',
      parameters: z.object({api_key: z.string(), name: z.string()}),
      readOnly: true,
      execute: async () => ({ok: true}),
    };
    const intent: IntentDefinition = {
      id: 'auth',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('authy', {api_key: 'sk-secret-123', name: 'public'});
        return {};
      },
    };
    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({authy: tool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );
    const startEvent = result.events.find((e) => e.type === SSEEventType.ToolCallStart);
    expect(startEvent).toBeDefined();
    const params = (startEvent as Extract<SSEEvent, {type: SSEEventType.ToolCallStart}>).parameters;
    expect(params['api_key']).toBe('[REDACTED]');
    expect(params['name']).toBe('public');
  });

  it('produces tool result messages in agent-loop shape (text-as-string)', async () => {
    const tool: ToolDefinition = {
      description: 'echo',
      parameters: z.object({}),
      readOnly: true,
      execute: async () => ({ok: true, count: 12}),
    };
    const intent: IntentDefinition = {
      id: 'echo',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('echo', {});
        return {};
      },
    };
    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({echo: tool}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );
    if (result.outcome.kind !== 'completed') throw new Error('expected completed');
    expect(result.outcome.toolMessages).toHaveLength(1);
    const content = result.outcome.toolMessages[0].content as Array<{
      type: string;
      output: {type: string; value: unknown};
    }>;
    expect(content[0].type).toBe('tool-result');
    expect(content[0].output.type).toBe('text');
    // Stringified JSON, matching what the agent loop's
    // buildToolResultMessage produces — same wire format on rehydration.
    expect(content[0].output.value).toBe('{"ok":true,"count":12}');
  });

  it('emitText flows into text_delta and the assistant message', async () => {
    const intent: IntentDefinition = {
      id: 'speak',
      regex: /^run$/,
      handle: async (ctx) => {
        ctx.emitText('Hello! ');
        ctx.emitText('All set.');
        return {};
      },
    };

    const result = await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'test',
        scopeId: '',
        toolRegistry: makeRegistry({}),
        buildToolContext: () => freshToolContext(),
        logger: silentLogger,
      }),
    );

    const textEvents = result.events.filter((e) => e.type === SSEEventType.TextDelta);
    expect(textEvents.length).toBe(2);

    if (result.outcome.kind !== 'completed') throw new Error('expected completed');
    const content = result.outcome.assistantMessage.content as Array<{type: string; text?: string}>;
    const textPart = content.find((c) => c.type === 'text');
    expect(textPart?.text).toBe('Hello! All set.');
  });
});

// ---------------------------------------------------------------------------
// Telemetry — Phase 4
//
// runIntent emits four lifecycle events: intent_matched (always),
// intent_completed (success), intent_fell_through (pre-commit null),
// intent_errored (handler throw / blocked tool / bad params). Aggregating
// these per session lets us measure the LLM-call drop in production.
// ---------------------------------------------------------------------------

describe('runIntent — telemetry', () => {
  function makeLogger(): typeof silentLogger & {
    infoEvents: () => Array<{event: string; data: Record<string, unknown>}>;
    warnEvents: () => Array<{event: string; data: Record<string, unknown>}>;
  } {
    const infos: Array<{event: string; data: Record<string, unknown>}> = [];
    const warns: Array<{event: string; data: Record<string, unknown>}> = [];
    return {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn((event: string, data?: Record<string, unknown>) => {
        infos.push({event, data: data ?? {}});
      }),
      warn: vi.fn((event: string, data?: Record<string, unknown>) => {
        warns.push({event, data: data ?? {}});
      }),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
      infoEvents: () => infos,
      warnEvents: () => warns,
    };
  }

  it('logs intent_matched + intent_completed on a successful run', async () => {
    const tool: ToolDefinition = {
      description: 'noop',
      parameters: z.object({}),
      readOnly: true,
      execute: async () => ({ok: true}),
    };
    const intent: IntentDefinition = {
      id: 'install-template',
      regex: /^run$/,
      handle: async (ctx) => {
        await ctx.callTool('noop', {});
        ctx.emitText('done');
        return {};
      },
    };
    const logger = makeLogger();
    await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'sess-abc',
        scopeId: '',
        toolRegistry: makeRegistry({noop: tool}),
        buildToolContext: () => freshToolContext(),
        logger,
      }),
    );

    const events = logger.infoEvents().map((e) => e.event);
    expect(events).toContain('intent_matched');
    expect(events).toContain('intent_completed');

    const completed = logger.infoEvents().find((e) => e.event === 'intent_completed');
    expect(completed?.data['intentId']).toBe('install-template');
    expect(completed?.data['sessionId']).toBe('sess-abc');
    expect(completed?.data['toolCount']).toBe(1);
    expect(completed?.data['hasText']).toBe(true);
    expect(typeof completed?.data['durationMs']).toBe('number');
  });

  it('logs intent_fell_through when handler returns null pre-commit', async () => {
    const intent: IntentDefinition = {
      id: 'precheck',
      regex: /^run$/,
      handle: async () => null,
    };
    const logger = makeLogger();
    await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'sess-xyz',
        scopeId: '',
        toolRegistry: makeRegistry({}),
        buildToolContext: () => freshToolContext(),
        logger,
      }),
    );

    const events = logger.infoEvents().map((e) => e.event);
    expect(events).toContain('intent_matched');
    expect(events).toContain('intent_fell_through');
    expect(events).not.toContain('intent_completed');

    const fell = logger.infoEvents().find((e) => e.event === 'intent_fell_through');
    expect(fell?.data['intentId']).toBe('precheck');
    expect(fell?.data['sessionId']).toBe('sess-xyz');
  });

  it('logs intent_errored when handler throws', async () => {
    const intent: IntentDefinition = {
      id: 'crash',
      regex: /^run$/,
      handle: async () => {
        throw new Error('boom');
      },
    };
    const logger = makeLogger();
    await drain(
      runIntent({
        match: {intent, match: execMatch(/^run$/, 'run')},
        userMessage: 'run',
        sessionId: 'sess-err',
        scopeId: '',
        toolRegistry: makeRegistry({}),
        buildToolContext: () => freshToolContext(),
        logger,
      }),
    );

    const warns = logger.warnEvents().map((e) => e.event);
    expect(warns).toContain('intent_errored');

    const errored = logger.warnEvents().find((e) => e.event === 'intent_errored');
    expect(errored?.data['intentId']).toBe('crash');
    expect(errored?.data['error']).toBe('boom');
    expect(errored?.data['toolCallsStarted']).toBe(0);
  });
});

