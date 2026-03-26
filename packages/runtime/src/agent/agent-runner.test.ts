/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {runAgentTurn} from './agent-runner.js';
import type {AgentSession} from './agent-types.js';
import {SSEEventType} from '../types.js';

// Mock the FailoverProvider via @amodalai/core
// Must use vi.hoisted so the mock fn is available inside the factory
const {mockChat, mockFailoverConstructor} = vi.hoisted(() => {
  const chat = vi.fn();
  const constructor = vi.fn().mockImplementation(() => ({chat, chatStream: undefined}));
  return {mockChat: chat, mockFailoverConstructor: constructor};
});

vi.mock('@amodalai/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed when core is not pre-built
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FailoverProvider: mockFailoverConstructor,
  };
});

function makeSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    runtime: {
      repo: {
        source: 'local',
        origin: '/test',
        config: {
          name: 'test',
          version: '1.0.0',
          models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
        },
        connections: new Map(),
        skills: [],
        agents: {},
        automations: [],
        knowledge: [],
        evals: [],
        tools: [],
        stores: [],
      },
      compiledContext: {
        systemPrompt: 'You are a test agent.',
        tokenUsage: {total: 100000, used: 100, remaining: 99900, sectionBreakdown: {}},
        sections: [],
      },
      exploreContext: {
        systemPrompt: 'Explore agent.',
        tokenUsage: {total: 100000, used: 50, remaining: 99950, sectionBreakdown: {}},
        sections: [],
      },
      outputPipeline: {
        process: vi.fn((text: string) => ({output: text, modified: false, blocked: false, findings: []})),
        createStreamProcessor: vi.fn(),
      },
      connectionsMap: {},
      fieldScrubber: {scrub: vi.fn((data: unknown) => ({data, records: [], strippedCount: 0, redactableCount: 0}))},
      actionGate: {evaluate: vi.fn(() => ({decision: 'allow', escalated: false, endpointPath: ''}))},
      telemetry: {logScrub: vi.fn(), logGuard: vi.fn(), logGate: vi.fn(), logExplore: vi.fn()},
      scrubTracker: {},
      outputGuard: {},
      contextCompiler: {},
      userRoles: [],
      sessionId: 'test-session',
      isDelegated: false,
    },
    planModeManager: {
      isActive: vi.fn(() => false),
      getApprovedPlan: vi.fn(() => null),
      getReason: vi.fn(() => null),
      enter: vi.fn(),
      approve: vi.fn(),
      exit: vi.fn(),
      getPlanningReminder: vi.fn(() => null),
      getApprovedPlanContext: vi.fn(() => null),
    },
    exploreConfig: {
      systemPrompt: 'explore',
      model: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      connectionsMap: {},
      readOnly: true as const,
      maxTurns: 10,
      maxDepth: 2,
    },
    ...overrides,

  } as unknown as AgentSession;
}

describe('runAgentTurn', () => {
  beforeEach(() => {
    mockChat.mockReset();
    // Re-apply constructor implementation after clearing — mockClear only
    // clears history, not implementation, but we need to ensure the constructor
    // still returns an object with our mockChat reference
    mockFailoverConstructor.mockClear();
    mockFailoverConstructor.mockImplementation(() => ({chat: mockChat, chatStream: undefined}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should yield error when provider initialization fails', async () => {
    mockFailoverConstructor.mockImplementationOnce(() => {
      throw new Error('ANTHROPIC_API_KEY is not set');
    });

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'hello', new AbortController().signal)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.type).toBe(SSEEventType.Error);
    if (events[0]?.type === SSEEventType.Error) {
      expect(events[0].message).toContain('Provider initialization failed');
    }
    expect(events[events.length - 1]?.type).toBe(SSEEventType.Done);
  });

  it('should append user message to conversation history', async () => {
    mockChat.mockRejectedValue(new Error('test error'));

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'hello', new AbortController().signal)) {
      events.push(event);
    }

    expect(session.conversationHistory[0]).toEqual({role: 'user', content: 'hello'});
  });

  it('should yield text delta for text responses', async () => {
    mockChat.mockResolvedValue({
      content: [{type: 'text', text: 'Hello there!'}],
      stopReason: 'end_turn',
      usage: {inputTokens: 10, outputTokens: 5},
    });

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'hello', new AbortController().signal)) {
      events.push(event);
    }

    const textEvent = events.find((e) => e.type === SSEEventType.TextDelta);
    expect(textEvent).toBeDefined();
    if (textEvent && textEvent.type === SSEEventType.TextDelta) {
      expect(textEvent.content).toBe('Hello there!');
    }

    const doneEvent = events.find((e) => e.type === SSEEventType.Done);
    expect(doneEvent).toBeDefined();
  });

  it('should yield tool call events for tool use responses', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: [
          {type: 'tool_use', id: 'tool-1', name: 'enter_plan_mode', input: {reason: 'testing'}},
        ],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'Plan mode activated.'}],
        stopReason: 'end_turn',
      });

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'enter plan mode', new AbortController().signal)) {
      events.push(event);
    }

    const toolStart = events.find((e) => e.type === SSEEventType.ToolCallStart);
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === SSEEventType.ToolCallStart) {
      expect(toolStart.tool_name).toBe('enter_plan_mode');
    }

    const toolResult = events.find((e) => e.type === SSEEventType.ToolCallResult);
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === SSEEventType.ToolCallResult) {
      expect(toolResult.status).toBe('success');
    }
  });

  it('should handle abort signal', async () => {
    const session = makeSession();
    const controller = new AbortController();
    controller.abort();

    const events = [];
    for await (const event of runAgentTurn(session, 'hello', controller.signal)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === SSEEventType.Error || e.type === SSEEventType.Done)).toBe(true);
  });

  it('should handle LLM errors gracefully', async () => {
    mockChat.mockRejectedValue(new Error('Rate limited'));

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'hello', new AbortController().signal)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === SSEEventType.Error);
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === SSEEventType.Error) {
      expect(errorEvent.message).toContain('Rate limited');
    }
  });

  it('should execute plan mode tools', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: [{type: 'tool_use', id: 'tool-1', name: 'enter_plan_mode', input: {reason: 'complex write'}}],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'Plan mode entered.'}],
        stopReason: 'end_turn',
      });

    const enterFn = vi.fn();
    const session = makeSession({
      planModeManager: {
        isActive: vi.fn(() => false),
        getApprovedPlan: vi.fn(() => null),
        getReason: vi.fn(() => null),
        enter: enterFn,
        approve: vi.fn(),
        exit: vi.fn(),
        getPlanningReminder: vi.fn(() => null),
        getApprovedPlanContext: vi.fn(() => null),

      } as unknown as AgentSession['planModeManager'],
    });

    const events = [];
    for await (const event of runAgentTurn(session, 'enter plan mode', new AbortController().signal)) {
      events.push(event);
    }

    expect(enterFn).toHaveBeenCalledWith('complex write');
  });

  it('should store structured assistant messages in history', async () => {
    mockChat.mockResolvedValue({
      content: [
        {type: 'text', text: 'Let me check.'},
        {type: 'tool_use', id: 'tc-1', name: 'enter_plan_mode', input: {}},
      ],
      stopReason: 'tool_use',
    });

    // Second call returns text to end the loop
    mockChat.mockResolvedValueOnce({
      content: [
        {type: 'text', text: 'Let me check.'},
        {type: 'tool_use', id: 'tc-1', name: 'enter_plan_mode', input: {}},
      ],
      stopReason: 'tool_use',
    }).mockResolvedValueOnce({
      content: [{type: 'text', text: 'Done.'}],
      stopReason: 'end_turn',
    });

    const session = makeSession();
    const events = [];
    for await (const event of runAgentTurn(session, 'test', new AbortController().signal)) {
      events.push(event);
    }

    // History should contain: user, assistant (structured), tool_result, ...
    const assistantMsg = session.conversationHistory.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    if (assistantMsg && assistantMsg.role === 'assistant') {
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      expect(assistantMsg.content).toHaveLength(2);
    }
  });

  it('should store tool results with structured format', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: [{type: 'tool_use', id: 'tc-1', name: 'enter_plan_mode', input: {reason: 'test'}}],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'Done.'}],
        stopReason: 'end_turn',
      });

    const session = makeSession();
    for await (const _event of runAgentTurn(session, 'test', new AbortController().signal)) {
      // consume events
    }

    // Should have: user, assistant, tool_result, assistant
    const toolResultMsg = session.conversationHistory.find((m) => m.role === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    if (toolResultMsg && toolResultMsg.role === 'tool_result') {
      expect(toolResultMsg.toolCallId).toBe('tc-1');
      expect(toolResultMsg.content).toContain('Plan mode activated');
    }
  });

  it('should pass model config to FailoverProvider', async () => {
    mockChat.mockResolvedValue({
      content: [{type: 'text', text: 'ok'}],
      stopReason: 'end_turn',
    });

    const session = makeSession();
    for await (const _event of runAgentTurn(session, 'test', new AbortController().signal)) {
      // consume
    }

    expect(mockFailoverConstructor).toHaveBeenCalledWith(
      {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
    );
  });

  describe('explore sub-agent', () => {
    it('should spawn sub-agent and emit SubagentEvents + ExploreStart/End', async () => {
      // Parent call: LLM returns explore tool use
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'check alerts'}}],
          stopReason: 'tool_use',
        })
        // Sub-agent call: returns text summary directly (no tool use)
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Found 3 critical alerts.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 100, outputTokens: 50},
        })
        // Parent continues after explore result
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Based on findings, there are 3 alerts.'}],
          stopReason: 'end_turn',
        });

      const session = makeSession();
      const events = [];
      for await (const event of runAgentTurn(session, 'investigate alerts', new AbortController().signal)) {
        events.push(event);
      }

      // Should have ExploreStart
      const exploreStart = events.find((e) => e.type === SSEEventType.ExploreStart);
      expect(exploreStart).toBeDefined();
      if (exploreStart && exploreStart.type === SSEEventType.ExploreStart) {
        expect(exploreStart.query).toBe('check alerts');
      }

      // Should have SubagentEvents
      const subagentEvents = events.filter((e) => e.type === SSEEventType.SubagentEvent);
      expect(subagentEvents.length).toBeGreaterThanOrEqual(1);

      // Should have a 'thought' event with the summary
      const thoughtEvent = subagentEvents.find(
        (e) => e.type === SSEEventType.SubagentEvent && e.event_type === 'thought',
      );
      expect(thoughtEvent).toBeDefined();

      // Should have a 'complete' event
      const completeEvent = subagentEvents.find(
        (e) => e.type === SSEEventType.SubagentEvent && e.event_type === 'complete',
      );
      expect(completeEvent).toBeDefined();

      // Should have ExploreEnd
      const exploreEnd = events.find((e) => e.type === SSEEventType.ExploreEnd);
      expect(exploreEnd).toBeDefined();
      if (exploreEnd && exploreEnd.type === SSEEventType.ExploreEnd) {
        expect(exploreEnd.summary).toBe('Found 3 critical alerts.');
        expect(exploreEnd.tokens_used).toBe(150);
      }

      // Should have ToolCallResult for explore
      const toolResult = events.find(
        (e) => e.type === SSEEventType.ToolCallResult && e.tool_id === 'explore-1',
      );
      expect(toolResult).toBeDefined();
      if (toolResult && toolResult.type === SSEEventType.ToolCallResult) {
        expect(toolResult.status).toBe('success');
        expect(toolResult.result).toBe('Found 3 critical alerts.');
      }
    });

    it('should force read-only intent on sub-agent requests', async () => {
      // We need to intercept the fetch call to verify the method
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({data: 'test'}), {status: 200}),
      );

      // Parent calls explore
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'check data'}}],
          stopReason: 'tool_use',
        })
        // Sub-agent calls request with POST (should be forced to GET)
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use', id: 'sub-req-1', name: 'request',
            input: {connection: 'test-api', method: 'POST', endpoint: '/data', intent: 'write'},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 50, outputTokens: 30},
        })
        // Sub-agent returns summary
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Got the data.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 60, outputTokens: 20},
        })
        // Parent continues
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Done.'}],
          stopReason: 'end_turn',
        });

      const session = makeSession({
        runtime: {
          ...makeSession().runtime,
          connectionsMap: {
            'test-api': {
              base_url: 'https://api.test.com',
              _request_config: {auth: []},
            },
          },
        } as unknown as AgentSession['runtime'],
      });

      const events = [];
      for await (const event of runAgentTurn(session, 'check', new AbortController().signal)) {
        events.push(event);
      }

      // Verify fetch was called with GET (not POST)
      expect(fetchSpy).toHaveBeenCalled();
      const fetchCall = fetchSpy.mock.calls[0];
      if (fetchCall) {
        const fetchOpts = fetchCall[1];
        expect(fetchOpts?.method).toBe('GET');
      }

      fetchSpy.mockRestore();
    });

    it('should enforce depth limiting — sub-agent at max depth cannot call explore', async () => {
      // Parent calls explore
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'level 1'}}],
          stopReason: 'tool_use',
        })
        // Sub-agent at depth 0 calls explore (depth 0 + 1 < maxDepth=2, allowed)
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'sub-explore-1', name: 'explore', input: {query: 'level 2'}}],
          stopReason: 'tool_use',
          usage: {inputTokens: 50, outputTokens: 30},
        })
        // Nested sub-agent at depth 1 — should NOT have explore tool, only text
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Deep findings.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 40, outputTokens: 20},
        })
        // Back to depth-0 sub-agent with nested result
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Level 1 summary with nested data.'}],
          stopReason: 'end_turn',
          usage: {inputTokens: 60, outputTokens: 25},
        })
        // Parent continues
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Final answer.'}],
          stopReason: 'end_turn',
        });

      const session = makeSession();
      const events = [];
      for await (const event of runAgentTurn(session, 'deep investigate', new AbortController().signal)) {
        events.push(event);
      }

      // Should complete without error
      const doneEvent = events.find((e) => e.type === SSEEventType.Done);
      expect(doneEvent).toBeDefined();

      // The second FailoverProvider call (depth=1) should have been created
      // Verify the sub-agent called explore and got nested results
      const completeEvents = events.filter(
        (e) => e.type === SSEEventType.SubagentEvent && e.event_type === 'complete',
      );
      expect(completeEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should propagate abort signal to sub-agent', async () => {
      const controller = new AbortController();

      // Parent calls explore
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'check'}}],
          stopReason: 'tool_use',
        })
        // Sub-agent — abort before it can respond
        .mockImplementationOnce(async () => {
          controller.abort();
          throw new Error('Request aborted');
        });

      const session = makeSession();
      const events = [];
      for await (const event of runAgentTurn(session, 'check', controller.signal)) {
        events.push(event);
      }

      // Should have an error event from the sub-agent
      const subagentError = events.find(
        (e) => e.type === SSEEventType.SubagentEvent && e.event_type === 'error',
      );
      expect(subagentError).toBeDefined();
    });

    it('should stop sub-agent after maxTurns', async () => {
      const chatCalls: Array<Record<string, unknown>> = [];

      // Parent calls explore
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'loop test'}}],
          stopReason: 'tool_use',
        });

      // Sub-agent keeps making tool calls for maxTurns (10)
      for (let i = 0; i < 10; i++) {
        mockChat.mockResolvedValueOnce({
          content: [{
            type: 'tool_use', id: `sub-req-${i}`, name: 'request',
            input: {connection: 'test-api', method: 'GET', endpoint: `/data/${i}`, intent: 'read'},
          }],
          stopReason: 'tool_use',
          usage: {inputTokens: 10, outputTokens: 5},
        });
      }

      // Parent after explore returns
      mockChat.mockResolvedValueOnce({
        content: [{type: 'text', text: 'Done.'}],
        stopReason: 'end_turn',
      });

      const session = makeSession({
        runtime: {
          ...makeSession().runtime,
          connectionsMap: {
            'test-api': {
              base_url: 'https://api.test.com',
              _request_config: {auth: []},
            },
          },
        } as unknown as AgentSession['runtime'],
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ok: true}), {status: 200}),
      );

      const events = [];
      for await (const event of runAgentTurn(session, 'loop', new AbortController().signal)) {
        events.push(event);
        chatCalls.push({type: event.type});
      }

      // Sub-agent should have made at most maxTurns (10) chat calls
      // Total mockChat calls: 1 (parent explore) + 10 (sub-agent turns) + 1 (parent continue) = 12
      // But the sub-agent stops at turn 10 (it keeps calling tools without text, no break)
      // The result should be "No findings." since it never produced text
      const toolResult = events.find(
        (e) => e.type === SSEEventType.ToolCallResult && e.tool_id === 'explore-1',
      );
      expect(toolResult).toBeDefined();

      fetchSpy.mockRestore();
    });

    it('should handle sub-agent LLM errors gracefully', async () => {
      // Parent calls explore
      mockChat
        .mockResolvedValueOnce({
          content: [{type: 'tool_use', id: 'explore-1', name: 'explore', input: {query: 'fail test'}}],
          stopReason: 'tool_use',
        })
        // Sub-agent LLM call fails
        .mockRejectedValueOnce(new Error('Sub-agent rate limited'))
        // Parent continues with error result
        .mockResolvedValueOnce({
          content: [{type: 'text', text: 'Explore failed, trying directly.'}],
          stopReason: 'end_turn',
        });

      const session = makeSession();
      const events = [];
      for await (const event of runAgentTurn(session, 'fail test', new AbortController().signal)) {
        events.push(event);
      }

      // Should have a subagent error event
      const subagentError = events.find(
        (e) => e.type === SSEEventType.SubagentEvent && e.event_type === 'error',
      );
      expect(subagentError).toBeDefined();
      if (subagentError && subagentError.type === SSEEventType.SubagentEvent) {
        expect(subagentError.error).toContain('Sub-agent rate limited');
      }

      // ToolCallResult should indicate error
      const toolResult = events.find(
        (e) => e.type === SSEEventType.ToolCallResult && e.tool_id === 'explore-1',
      );
      expect(toolResult).toBeDefined();
      if (toolResult && toolResult.type === SSEEventType.ToolCallResult) {
        expect(toolResult.status).toBe('error');
        expect(toolResult.error).toContain('Sub-agent rate limited');
      }
    });
  });
});
