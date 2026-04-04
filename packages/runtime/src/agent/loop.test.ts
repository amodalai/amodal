/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 3.1 — Agent Loop Tests
 *
 * Tests the state machine core:
 * 1. Unit: each state handler produces expected transitions
 * 2. Integration: runAgent() full conversation flow
 * 3. Abort handling: clean shutdown on signal abort
 * 4. Turn budget: max_turns enforcement
 * 5. SSE event ordering (init first, done last, done always has usage)
 */

import {describe, it, expect, vi} from 'vitest';
import type {ModelMessage} from 'ai';
import {SSEEventType} from '../types.js';
import type {SSEEvent, SSEDoneEvent, SSEInitEvent} from '../types.js';
import {runAgent, transition} from './loop.js';
import type {
  AgentContext,
  AgentState,
  ThinkingState,
  StreamingState,
  ExecutingState,
  ConfirmingState,
} from './loop-types.js';
import {DEFAULT_LOOP_CONFIG} from './loop-types.js';
import type {TokenUsage, StreamTextResult, StreamEvent} from '../providers/types.js';
import type {ToolDefinition, ToolRegistry} from '../tools/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
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

function makeUsage(overrides?: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function makeMockToolDef(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    description: 'Test tool',
    parameters: {} as ToolDefinition['parameters'],
    execute: vi.fn().mockResolvedValue({output: 'tool result'}),
    readOnly: false,
    metadata: {category: 'custom'},
    ...overrides,
  };
}

function makeMockRegistry(tools: Record<string, ToolDefinition> = {}): ToolRegistry {
  return {
    register: vi.fn(),
    get: vi.fn((name: string) => tools[name]),
    getTools: vi.fn(() => tools),
    names: vi.fn(() => Object.keys(tools)),
    subset: vi.fn(),
    size: Object.keys(tools).length,
  };
}

/**
 * Create a mock StreamTextResult that yields the given stream events.
 */
function makeMockStream(
  events: StreamEvent[],
  text = 'Hello from the model',
): StreamTextResult {
  return {
    textStream: (async function* () {
      yield text;
    })(),
    fullStream: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    usage: Promise.resolve(makeUsage({inputTokens: 100, outputTokens: 50, totalTokens: 150})),
    text: Promise.resolve(text),
  };
}

function makeMockContext(overrides?: Partial<AgentContext>): AgentContext {
  const logger = makeMockLogger();
  return {
    provider: {
      model: 'test-model',
      provider: 'test',
      languageModel: {} as AgentContext['provider']['languageModel'],
      streamText: vi.fn(() => makeMockStream([
        {type: 'text-delta', textDelta: 'Hello'},
        {type: 'finish', usage: makeUsage({inputTokens: 100, outputTokens: 50, totalTokens: 150})},
      ])),
      generateText: vi.fn(),
    },
    toolRegistry: makeMockRegistry(),
    permissionChecker: {
      check: vi.fn().mockReturnValue({allowed: true}),
    },
    logger,
    signal: new AbortController().signal,
    sessionId: 'test-session',
    tenantId: 'test-tenant',
    user: {roles: ['user']},
    systemPrompt: 'You are a helpful assistant.',
    messages: [],
    usage: makeUsage(),
    turnCount: 0,
    maxTurns: 10,
    maxContextTokens: 200_000,
    config: {...DEFAULT_LOOP_CONFIG},
    preExecutionCache: new Map(),
    waitForConfirmation: vi.fn().mockResolvedValue(true),
    buildToolContext: vi.fn().mockReturnValue({
      request: vi.fn(),
      store: vi.fn(),
      env: vi.fn(),
      log: vi.fn(),
      user: {roles: []},
      signal: new AbortController().signal,
      sessionId: 'test-session',
      tenantId: 'test-tenant',
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Unit: transition dispatcher + exhaustive switch
// ---------------------------------------------------------------------------

describe('transition', () => {
  it('dispatches thinking state to handleThinking', async () => {
    const ctx = makeMockContext();
    const state: ThinkingState = {type: 'thinking', messages: []};

    const result = await transition(state, ctx);

    // Should transition to streaming
    expect(result.next.type).toBe('streaming');
    expect(ctx.turnCount).toBe(1);
  });

  it('dispatches done state as pass-through', async () => {
    const ctx = makeMockContext();
    const state: AgentState = {type: 'done', usage: makeUsage(), reason: 'model_stop'};

    const result = await transition(state, ctx);
    expect(result.next).toBe(state);
    expect(result.effects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. State handler unit tests
// ---------------------------------------------------------------------------

describe('handleThinking (via transition)', () => {
  it('increments turn count and starts streaming', async () => {
    const ctx = makeMockContext();
    const state: ThinkingState = {type: 'thinking', messages: []};

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('streaming');
    expect(ctx.turnCount).toBe(1);
    expect(ctx.provider.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a helpful assistant.',
        abortSignal: ctx.signal,
      }),
    );
  });

  it('passes tool schemas without execute functions to provider', async () => {
    const testTool = makeMockToolDef({description: 'Search repos'});
    const registry = makeMockRegistry({search: testTool});
    const ctx = makeMockContext({toolRegistry: registry});

    await transition({type: 'thinking', messages: []}, ctx);

    const streamTextCall = vi.mocked(ctx.provider.streamText).mock.calls[0][0];
    const tools = streamTextCall.tools as Record<string, unknown>;
    expect(tools['search']).toBeDefined();
    // Should have inputSchema (not parameters) and no execute
    expect(tools['search']).toHaveProperty('inputSchema');
    expect(tools['search']).not.toHaveProperty('execute');
  });
});

describe('handleStreaming (via transition)', () => {
  it('text-only response transitions to done(model_stop)', async () => {
    const stream = makeMockStream([
      {type: 'text-delta', textDelta: 'Hello!'},
      {type: 'finish', usage: makeUsage({inputTokens: 50, outputTokens: 20, totalTokens: 70})},
    ]);

    const ctx = makeMockContext();
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('done');
    if (result.next.type === 'done') {
      expect(result.next.reason).toBe('model_stop');
    }

    // Should have emitted text_delta events
    const textEvents = result.effects.filter(
      (e) => e.type === SSEEventType.TextDelta,
    );
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it('tool call response transitions to executing', async () => {
    const stream = makeMockStream([
      {type: 'text-delta', textDelta: 'Let me search.'},
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'search',
        args: {query: 'test'},
      },
      {type: 'finish', usage: makeUsage({inputTokens: 50, outputTokens: 20, totalTokens: 70})},
    ], 'Let me search.');

    const ctx = makeMockContext();
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('executing');
    if (result.next.type === 'executing') {
      expect(result.next.current.toolCallId).toBe('call-1');
      expect(result.next.current.toolName).toBe('search');
      expect(result.next.current.args).toEqual({query: 'test'});
    }
  });

  it('tracks token usage from finish events', async () => {
    const stream = makeMockStream([
      {type: 'finish', usage: makeUsage({inputTokens: 100, outputTokens: 50, totalTokens: 150})},
    ]);

    const ctx = makeMockContext();
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    await transition(state, ctx);

    expect(ctx.usage.inputTokens).toBe(100);
    expect(ctx.usage.outputTokens).toBe(50);
  });

  it('stream error transitions to done(error)', async () => {
    const stream = makeMockStream([
      {type: 'error', error: new Error('Provider failed')},
    ]);

    const ctx = makeMockContext();
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('done');
    if (result.next.type === 'done') {
      expect(result.next.reason).toBe('error');
    }

    // Should have emitted an error SSE event
    const errorEvents = result.effects.filter((e) => e.type === SSEEventType.Error);
    expect(errorEvents.length).toBe(1);
  });

  it('pre-executes read-only tools during streaming', async () => {
    const readOnlyTool = makeMockToolDef({
      readOnly: true,
      execute: vi.fn().mockResolvedValue('cached result'),
    });
    const registry = makeMockRegistry({lookup: readOnlyTool});

    const stream = makeMockStream([
      {type: 'tool-call', toolCallId: 'call-ro', toolName: 'lookup', args: {id: '1'}},
      {type: 'finish', usage: makeUsage()},
    ], '');

    const ctx = makeMockContext({toolRegistry: registry});
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    await transition(state, ctx);

    // Pre-execution cache should have an entry
    expect(ctx.preExecutionCache.has('call-ro')).toBe(true);
  });

  it('logs pre-execution errors on abort instead of swallowing silently', async () => {
    const failingTool = makeMockToolDef({
      readOnly: true,
      execute: vi.fn().mockRejectedValue(new Error('tool crashed')),
    });
    const registry = makeMockRegistry({broken_lookup: failingTool});

    const stream = makeMockStream([
      {type: 'tool-call', toolCallId: 'call-fail', toolName: 'broken_lookup', args: {}},
      {type: 'finish', usage: makeUsage()},
    ], '');

    const ctx = makeMockContext({toolRegistry: registry});
    const state: StreamingState = {type: 'streaming', stream, pendingToolCalls: []};

    await transition(state, ctx);

    // Wait for the pre-execution promise to settle (it rejects)
    const cached = ctx.preExecutionCache.get('call-fail');
    expect(cached).toBeDefined();
    // The .catch() handler should have logged, not thrown
    await expect(cached).rejects.toThrow('tool crashed');

    // The suppression handler should have logged the error
    expect(ctx.logger.debug).toHaveBeenCalledWith('preexec_suppressed', expect.objectContaining({
      tool: 'broken_lookup',
      error: 'tool crashed',
    }));
  });
});

describe('handleExecuting (via transition)', () => {
  it('executes a tool and transitions to thinking when queue empty', async () => {
    const searchTool = makeMockToolDef({
      execute: vi.fn().mockResolvedValue({repos: ['amodal']}),
    });
    const registry = makeMockRegistry({search: searchTool});
    const ctx = makeMockContext({toolRegistry: registry});

    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {toolCallId: 'call-1', toolName: 'search', args: {q: 'test'}},
      results: [],
    };

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('thinking');
    expect(searchTool.execute).toHaveBeenCalledWith(
      {q: 'test'},
      expect.objectContaining({sessionId: 'test-session'}),
    );

    // Should emit tool_call_start and tool_call_result SSE events
    const startEvents = result.effects.filter((e) => e.type === SSEEventType.ToolCallStart);
    const resultEvents = result.effects.filter((e) => e.type === SSEEventType.ToolCallResult);
    expect(startEvents.length).toBe(1);
    expect(resultEvents.length).toBe(1);
  });

  it('continues to next tool when queue has more items', async () => {
    const tool = makeMockToolDef();
    const registry = makeMockRegistry({tool_a: tool, tool_b: tool});
    const ctx = makeMockContext({toolRegistry: registry});

    const state: ExecutingState = {
      type: 'executing',
      queue: [{toolCallId: 'call-2', toolName: 'tool_b', args: {}}],
      current: {toolCallId: 'call-1', toolName: 'tool_a', args: {}},
      results: [],
    };

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('executing');
    if (result.next.type === 'executing') {
      expect(result.next.current.toolCallId).toBe('call-2');
      expect(result.next.queue).toEqual([]);
    }
  });

  it('returns error result for unknown tool', async () => {
    const ctx = makeMockContext();
    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {toolCallId: 'call-1', toolName: 'nonexistent', args: {}},
      results: [],
    };

    const result = await transition(state, ctx);

    // Should transition to thinking (agent can recover)
    expect(result.next.type).toBe('thinking');
    // Messages should contain the error tool result
    expect(ctx.messages.length).toBeGreaterThan(0);
  });

  it('handles tool execution error as continue site', async () => {
    const failingTool = makeMockToolDef({
      execute: vi.fn().mockRejectedValue(new Error('API rate limit')),
    });
    const registry = makeMockRegistry({api_call: failingTool});
    const ctx = makeMockContext({toolRegistry: registry});

    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {toolCallId: 'call-1', toolName: 'api_call', args: {}},
      results: [],
    };

    const result = await transition(state, ctx);

    // Should NOT crash — transitions to thinking so model can recover
    expect(result.next.type).toBe('thinking');

    // Should emit tool_call_result with error status
    const resultEvents = result.effects.filter((e) => e.type === SSEEventType.ToolCallResult);
    expect(resultEvents.length).toBe(1);

    // Logger should have recorded the error
    expect(ctx.logger.error).toHaveBeenCalledWith('tool_execution_error', expect.objectContaining({
      tool: 'api_call',
    }));
  });

  it('rejects hallucinated args that fail schema validation', async () => {
    const {z} = await import('zod');
    const strictTool = makeMockToolDef({
      parameters: z.object({query: z.string(), limit: z.number().int().positive()}),
    });
    const registry = makeMockRegistry({search: strictTool});
    const ctx = makeMockContext({toolRegistry: registry});

    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {toolCallId: 'call-1', toolName: 'search', args: {query: 123, limit: -5}},
      results: [],
    };

    const result = await transition(state, ctx);

    // Should recover — transition to thinking with error message for the model
    expect(result.next.type).toBe('thinking');
    expect(ctx.logger.warn).toHaveBeenCalledWith('tool_args_invalid', expect.objectContaining({
      tool: 'search',
    }));
    // Should NOT have called execute
    expect(strictTool.execute).not.toHaveBeenCalled();
  });

  it('sanitizes sensitive parameters in SSE events', async () => {
    const tool = makeMockToolDef();
    const registry = makeMockRegistry({auth_tool: tool});
    const ctx = makeMockContext({toolRegistry: registry});

    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {
        toolCallId: 'call-1',
        toolName: 'auth_tool',
        args: {api_key: 'sk-secret123', query: 'hello'},
      },
      results: [],
    };

    const result = await transition(state, ctx);

    const startEvent = result.effects.find((e) => e.type === SSEEventType.ToolCallStart);
    expect(startEvent).toBeDefined();
    if (startEvent && 'parameters' in startEvent) {
      const params = (startEvent as {parameters: Record<string, unknown>}).parameters;
      expect(params['api_key']).toBe('[REDACTED]');
      expect(params['query']).toBe('hello');
    }
  });

  it('uses pre-execution cache for read-only tools', async () => {
    const readTool = makeMockToolDef({readOnly: true});
    const registry = makeMockRegistry({read_data: readTool});
    const ctx = makeMockContext({toolRegistry: registry});

    // Simulate pre-execution cache from streaming phase
    ctx.preExecutionCache.set('call-cached', Promise.resolve({data: 'cached'}));

    const state: ExecutingState = {
      type: 'executing',
      queue: [],
      current: {toolCallId: 'call-cached', toolName: 'read_data', args: {}},
      results: [],
    };

    await transition(state, ctx);

    // The cached result should be used — tool.execute should NOT be called again
    expect(readTool.execute).not.toHaveBeenCalled();
  });
});

describe('handleConfirming (via transition)', () => {
  it('approved confirmation resumes executing', async () => {
    const ctx = makeMockContext({
      waitForConfirmation: vi.fn().mockResolvedValue(true),
    });

    const state: ConfirmingState = {
      type: 'confirming',
      call: {toolCallId: 'call-1', toolName: 'delete_item', args: {id: '123'}},
      remainingQueue: [],
    };

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('executing');
    if (result.next.type === 'executing') {
      expect(result.next.current.toolCallId).toBe('call-1');
    }
  });

  it('denied confirmation transitions to thinking with denial message', async () => {
    const ctx = makeMockContext({
      waitForConfirmation: vi.fn().mockResolvedValue(false),
    });

    const state: ConfirmingState = {
      type: 'confirming',
      call: {toolCallId: 'call-1', toolName: 'delete_item', args: {id: '123'}},
      remainingQueue: [],
    };

    const result = await transition(state, ctx);

    expect(result.next.type).toBe('thinking');
    // A denial message should have been appended
    expect(ctx.messages.length).toBeGreaterThan(0);
  });
});

describe('handleCompacting (via transition)', () => {
  it('stub passes through to thinking with unchanged messages', async () => {
    const ctx = makeMockContext();
    const messages = [{role: 'user', content: 'Hello'}] as ModelMessage[];

    const result = await transition({type: 'compacting', messages}, ctx);

    expect(result.next.type).toBe('thinking');
    if (result.next.type === 'thinking') {
      expect(result.next.messages).toBe(messages);
    }
    expect(result.effects).toEqual([]);
    expect(ctx.logger.debug).toHaveBeenCalledWith('compacting_skipped', expect.objectContaining({
      reason: 'stub_implementation',
    }));
  });
});

describe('handleDispatching (via transition)', () => {
  it('stub transitions to done with error', async () => {
    const ctx = makeMockContext();

    const result = await transition({
      type: 'dispatching',
      task: {agentName: 'research-agent', toolSubset: ['search'], prompt: 'Find info'},
      parentMessages: [],
    }, ctx);

    expect(result.next.type).toBe('done');
    if (result.next.type === 'done') {
      expect(result.next.reason).toBe('error');
    }

    const errorEvents = result.effects.filter((e) => e.type === SSEEventType.Error);
    expect(errorEvents.length).toBe(1);

    expect(ctx.logger.warn).toHaveBeenCalledWith('dispatching_not_implemented', expect.objectContaining({
      agent: 'research-agent',
    }));
  });
});

// ---------------------------------------------------------------------------
// 3. Integration: runAgent() full flow
// ---------------------------------------------------------------------------

describe('runAgent', () => {
  it('text-only conversation: init → text_delta → done with usage', async () => {
    const ctx = makeMockContext();

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Hello'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    // Init is first
    expect(events[0].type).toBe(SSEEventType.Init);

    // Done is last
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe(SSEEventType.Done);

    // Done always has usage (G2)
    const doneEvent = lastEvent as SSEDoneEvent;
    expect(doneEvent.usage).toBeDefined();
    expect(doneEvent.usage?.input_tokens).toBeGreaterThanOrEqual(0);
    expect(doneEvent.usage?.output_tokens).toBeGreaterThanOrEqual(0);
  });

  it('tool call conversation: init → text → tool_start → tool_result → done', async () => {
    const searchTool = makeMockToolDef({
      execute: vi.fn().mockResolvedValue({results: ['found']}),
    });
    const registry = makeMockRegistry({search: searchTool});

    let callCount = 0;
    const provider = {
      model: 'test-model',
      provider: 'test',
      languageModel: {} as AgentContext['provider']['languageModel'],
      streamText: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: model requests a tool
          return makeMockStream([
            {type: 'text-delta', textDelta: 'Searching...'},
            {type: 'tool-call', toolCallId: 'c1', toolName: 'search', args: {q: 'test'}},
            {type: 'finish', usage: makeUsage({inputTokens: 50, outputTokens: 20, totalTokens: 70})},
          ], 'Searching...');
        }
        // Second call: model responds with text
        return makeMockStream([
          {type: 'text-delta', textDelta: 'Found results.'},
          {type: 'finish', usage: makeUsage({inputTokens: 80, outputTokens: 30, totalTokens: 110})},
        ], 'Found results.');
      }),
      generateText: vi.fn(),
    };

    const ctx = makeMockContext({provider, toolRegistry: registry});

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Search for test'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    // Should have init, text deltas, tool events, more text deltas, done
    const types = events.map((e) => e.type);
    expect(types[0]).toBe(SSEEventType.Init);
    expect(types[types.length - 1]).toBe(SSEEventType.Done);
    expect(types).toContain(SSEEventType.ToolCallStart);
    expect(types).toContain(SSEEventType.ToolCallResult);

    // tool_call_start must come before tool_call_result
    const startIdx = types.indexOf(SSEEventType.ToolCallStart);
    const resultIdx = types.indexOf(SSEEventType.ToolCallResult);
    expect(startIdx).toBeLessThan(resultIdx);

    // Provider should have been called twice (thinking → tool → thinking → done)
    expect(provider.streamText).toHaveBeenCalledTimes(2);
  });

  it('abort signal terminates the loop with user_abort', async () => {
    const abortController = new AbortController();

    // Provider that aborts after first call
    const provider = {
      model: 'test-model',
      provider: 'test',
      languageModel: {} as AgentContext['provider']['languageModel'],
      streamText: vi.fn(() => {
        // Abort after stream starts
        abortController.abort();
        return makeMockStream([
          {type: 'text-delta', textDelta: 'Starting...'},
          {type: 'finish', usage: makeUsage()},
        ]);
      }),
      generateText: vi.fn(),
    };

    const ctx = makeMockContext({provider, signal: abortController.signal});

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Hello'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    // Should end with done event
    const doneEvent = events[events.length - 1] as SSEDoneEvent;
    expect(doneEvent.type).toBe(SSEEventType.Done);
    // Usage should be present even on abort
    expect(doneEvent.usage).toBeDefined();
  });

  it('max turns terminates the loop', async () => {
    const tool = makeMockToolDef();
    const registry = makeMockRegistry({loop_tool: tool});

    // Provider always requests a tool call (infinite loop)
    const provider = {
      model: 'test-model',
      provider: 'test',
      languageModel: {} as AgentContext['provider']['languageModel'],
      streamText: vi.fn(() =>
        makeMockStream([
          {type: 'tool-call', toolCallId: `c-${Date.now()}`, toolName: 'loop_tool', args: {}},
          {type: 'finish', usage: makeUsage({inputTokens: 10, outputTokens: 5, totalTokens: 15})},
        ], ''),
      ),
      generateText: vi.fn(),
    };

    const ctx = makeMockContext({
      provider,
      toolRegistry: registry,
      maxTurns: 3,
    });

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Loop forever'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    // Should have terminated
    const doneEvent = events[events.length - 1] as SSEDoneEvent;
    expect(doneEvent.type).toBe(SSEEventType.Done);

    // Turn count should not exceed maxTurns
    expect(ctx.turnCount).toBeLessThanOrEqual(3);
  });

  it('done event always includes usage regardless of reason (G2)', async () => {
    // Abort immediately
    const abortController = new AbortController();
    abortController.abort();

    const ctx = makeMockContext({
      signal: abortController.signal,
      usage: makeUsage({inputTokens: 42, outputTokens: 13, totalTokens: 55}),
    });

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Test'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    const doneEvent = events[events.length - 1] as SSEDoneEvent;
    expect(doneEvent.type).toBe(SSEEventType.Done);
    expect(doneEvent.usage).toBeDefined();
    expect(doneEvent.usage?.input_tokens).toBe(42);
    expect(doneEvent.usage?.output_tokens).toBe(13);
  });

  it('init event has session_id', async () => {
    const ctx = makeMockContext({sessionId: 'sess-abc'});

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Hi'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    const initEvent = events[0] as SSEInitEvent;
    expect(initEvent.type).toBe(SSEEventType.Init);
    expect(initEvent.session_id).toBe('sess-abc');
  });

  it('logs agent_loop_start and agent_loop_done', async () => {
    const ctx = makeMockContext();

    const events: SSEEvent[] = [];
    for await (const event of runAgent({
      messages: [{role: 'user', content: 'Hello'}] as ModelMessage[],
      context: ctx,
    })) {
      events.push(event);
    }

    expect(ctx.logger.info).toHaveBeenCalledWith('agent_loop_start', expect.objectContaining({
      session: 'test-session',
      tenant: 'test-tenant',
    }));
    expect(ctx.logger.info).toHaveBeenCalledWith('agent_loop_done', expect.objectContaining({
      session: 'test-session',
      reason: expect.any(String),
    }));
  });
});
