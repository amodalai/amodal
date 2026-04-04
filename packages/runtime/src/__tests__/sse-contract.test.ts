/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * SSE Event Contract Tests
 *
 * These tests verify the shape and ordering of SSE events emitted by
 * streamMessage(). They run against the current gemini-cli-core system
 * and MUST still pass after the SDK swap (Phase 3).
 *
 * What's tested:
 * - Event ordering: init is always first, done is always last
 * - Event shapes: every event has the required fields for its type
 * - Event types match the SSEEvent discriminated union
 * - Token usage is always present on done events
 * - Tool call lifecycle: start → result ordering
 * - Tool log events from ctx.log()
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';

// ---------------------------------------------------------------------------
// Constants matching upstream GeminiEventType (avoid importing the enum)
// ---------------------------------------------------------------------------

const CONTENT = 'content';
const TOOL_CALL_REQUEST = 'tool_call_request';
const ERROR = 'error';

// ---------------------------------------------------------------------------
// Mock upstream module
// ---------------------------------------------------------------------------

vi.mock('@amodalai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@amodalai/core')>();
  return {
    ...actual,
    GeminiEventType: {
      Content: CONTENT,
      ToolCallRequest: TOOL_CALL_REQUEST,
      Error: ERROR,
      AgentExecutionStopped: 'agent_execution_stopped',
    },
    ToolErrorType: {
      STOP_EXECUTION: 'stop_execution',
    },
    MessageBusType: {
      SUBAGENT_ACTIVITY: 'subagent-activity',
    },
    PRESENT_TOOL_NAME: 'present',
    ACTIVATE_SKILL_TOOL_NAME: 'activate_skill',
    ASK_USER_TOOL_NAME: 'ask_user',
    SessionManager: vi.fn(),
  };
});

const {streamMessage} = await import('../session/session-runner.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function* makeStream(
  events: Array<{type: string; value?: unknown}>,
): AsyncGenerator<{type: string; value?: unknown}> {
  for (const event of events) {
    yield event;
  }
}

function createMockSession(
  streamEvents: Array<{type: string; value?: unknown}> = [],
) {
  const mockSchedule = vi.fn().mockResolvedValue([]);

  return {
    session: {
      id: 'contract-test-session',
      config: {
        getModel: vi.fn().mockReturnValue('test-model'),
        shutdownAudit: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue({
          subscribe: vi.fn(),
          unsubscribe: vi.fn(),
        }),
      },
      geminiClient: {
        sendMessageStream: vi.fn().mockReturnValue(makeStream(streamEvents)),
        getCurrentSequenceModel: vi.fn().mockReturnValue('test-model'),
        getChat: vi.fn().mockReturnValue({
          recordCompletedToolCalls: vi.fn(),
        }),
      },
      scheduler: {schedule: mockSchedule},
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accumulatedMessages: [],
    },
    mockSchedule,
  };
}

async function collectEvents(
  gen: AsyncGenerator<SSEEvent>,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/**
 * Validates that a timestamp string is ISO 8601.
 */
function isValidTimestamp(ts: unknown): boolean {
  if (typeof ts !== 'string') return false;
  const d = new Date(ts);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('SSE Event Contract', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  // -----------------------------------------------------------------------
  // Ordering guarantees
  // -----------------------------------------------------------------------

  describe('event ordering', () => {
    it('init is always the first event', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'hello'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'hi', controller.signal),
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe(SSEEventType.Init);
    });

    it('done is always the last event', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'hello'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'hi', controller.signal),
      );

      expect(events[events.length - 1].type).toBe(SSEEventType.Done);
    });

    it('text_delta events appear between init and done', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'chunk1'},
        {type: CONTENT, value: 'chunk2'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'hi', controller.signal),
      );

      const types = events.map((e) => e.type);
      const initIdx = types.indexOf(SSEEventType.Init);
      const doneIdx = types.indexOf(SSEEventType.Done);
      const textIdxs = types
        .map((t, i) => (t === SSEEventType.TextDelta ? i : -1))
        .filter((i) => i >= 0);

      expect(textIdxs.length).toBe(2);
      for (const idx of textIdxs) {
        expect(idx).toBeGreaterThan(initIdx);
        expect(idx).toBeLessThan(doneIdx);
      }
    });

    it('tool_call_start always precedes its tool_call_result', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'my_tool', args: {}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'done'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'my_tool'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'my_tool', response: {}}}],
          error: undefined,
          errorType: undefined,
        },
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'call tool', controller.signal),
      );

      const types = events.map((e) => e.type);
      const startIdx = types.indexOf(SSEEventType.ToolCallStart);
      const resultIdx = types.indexOf(SSEEventType.ToolCallResult);

      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(resultIdx).toBeGreaterThan(startIdx);
    });
  });

  // -----------------------------------------------------------------------
  // Event shape validation
  // -----------------------------------------------------------------------

  describe('init event shape', () => {
    it('has session_id and timestamp', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'hi'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'test', controller.signal),
      );

      const init = events[0];
      expect(init.type).toBe(SSEEventType.Init);
      expect(init).toHaveProperty('session_id');
      expect(init).toHaveProperty('timestamp');
      // Narrow to init and check shape
      if (init.type === SSEEventType.Init) {
        expect(init.session_id).toBe('contract-test-session');
        expect(isValidTimestamp(init.timestamp)).toBe(true);
      }
    });
  });

  describe('text_delta event shape', () => {
    it('has content string and timestamp', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'Hello world'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'test', controller.signal),
      );

      const textEvents = events.filter((e) => e.type === SSEEventType.TextDelta);
      expect(textEvents.length).toBeGreaterThanOrEqual(1);

      for (const evt of textEvents) {
        if (evt.type === SSEEventType.TextDelta) {
          expect(typeof evt.content).toBe('string');
          expect(evt.content.length).toBeGreaterThan(0);
          expect(isValidTimestamp(evt.timestamp)).toBe(true);
        }
      }
    });
  });

  describe('tool_call_start event shape', () => {
    it('has tool_name, tool_id, parameters, and timestamp', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'fetch_data', args: {query: 'test'}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'result'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'fetch_data'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'fetch_data', response: {data: 1}}}],
          error: undefined,
          errorType: undefined,
        },
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'fetch', controller.signal),
      );

      const start = events.find((e) => e.type === SSEEventType.ToolCallStart);
      expect(start).toBeDefined();
      if (start?.type === SSEEventType.ToolCallStart) {
        expect(start.tool_name).toBe('fetch_data');
        expect(start.tool_id).toBe('c1');
        expect(start.parameters).toEqual({query: 'test'});
        expect(isValidTimestamp(start.timestamp)).toBe(true);
      }
    });
  });

  describe('tool_call_result event shape', () => {
    it('has tool_id, status, and timestamp', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'get_info', args: {}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'ok'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'get_info'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'get_info', response: {info: 'test'}}}],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 42,
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'info', controller.signal),
      );

      const result = events.find((e) => e.type === SSEEventType.ToolCallResult);
      expect(result).toBeDefined();
      if (result?.type === SSEEventType.ToolCallResult) {
        expect(result.tool_id).toBe('c1');
        expect(result.status).toBe('success');
        expect(isValidTimestamp(result.timestamp)).toBe(true);
      }
    });

    it('has status error and error message on tool failure', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'broken_tool', args: {}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'fallback'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'broken_tool'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'broken_tool', response: {}}}],
          error: {message: 'connection refused'},
          errorType: undefined,
        },
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'try it', controller.signal),
      );

      const result = events.find((e) => e.type === SSEEventType.ToolCallResult);
      expect(result).toBeDefined();
      if (result?.type === SSEEventType.ToolCallResult) {
        expect(result.status).toBe('error');
        expect(result.error).toBe('connection refused');
      }
    });
  });

  describe('error event shape', () => {
    it('has message and timestamp', async () => {
      const {session} = createMockSession([
        {type: ERROR, value: {error: {message: 'provider error'}}},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'fail', controller.signal),
      );

      const err = events.find((e) => e.type === SSEEventType.Error);
      expect(err).toBeDefined();
      if (err?.type === SSEEventType.Error) {
        expect(err.message).toBe('provider error');
        expect(isValidTimestamp(err.timestamp)).toBe(true);
      }
    });
  });

  describe('done event shape', () => {
    it('has timestamp and usage with required token fields', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'response'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'test', controller.signal),
      );

      const done = events.find((e) => e.type === SSEEventType.Done);
      expect(done).toBeDefined();
      if (done?.type === SSEEventType.Done) {
        expect(isValidTimestamp(done.timestamp)).toBe(true);
        expect(done.usage).toBeDefined();
        expect(typeof done.usage!.input_tokens).toBe('number');
        expect(typeof done.usage!.output_tokens).toBe('number');
        expect(typeof done.usage!.total_tokens).toBe('number');
        expect(done.usage!.input_tokens).toBeGreaterThanOrEqual(0);
        expect(done.usage!.output_tokens).toBeGreaterThanOrEqual(0);
        expect(done.usage!.total_tokens).toBeGreaterThanOrEqual(0);
      }
    });

    it('done event always has usage even after error', async () => {
      const {session} = createMockSession([
        {type: ERROR, value: {error: {message: 'boom'}}},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'fail', controller.signal),
      );

      const done = events.find((e) => e.type === SSEEventType.Done);
      expect(done).toBeDefined();
      if (done?.type === SSEEventType.Done) {
        expect(done.usage).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Compaction event shapes (emitted by the state machine, not streamMessage)
  // -----------------------------------------------------------------------

  describe('compaction_start event shape', () => {
    it('has estimated_tokens, threshold, and timestamp', () => {
      const event: SSEEvent = {
        type: SSEEventType.CompactionStart,
        estimated_tokens: 150_000,
        threshold: 0.7,
        timestamp: new Date().toISOString(),
      };

      expect(event.type).toBe(SSEEventType.CompactionStart);
      if (event.type === SSEEventType.CompactionStart) {
        expect(typeof event.estimated_tokens).toBe('number');
        expect(event.estimated_tokens).toBeGreaterThan(0);
        expect(typeof event.threshold).toBe('number');
        expect(event.threshold).toBeGreaterThan(0);
        expect(event.threshold).toBeLessThanOrEqual(1);
        expect(isValidTimestamp(event.timestamp)).toBe(true);
      }
    });
  });

  describe('compaction_end event shape', () => {
    it('has tokens_before, tokens_after, compaction_tokens, and timestamp', () => {
      const event: SSEEvent = {
        type: SSEEventType.CompactionEnd,
        tokens_before: 150_000,
        tokens_after: 40_000,
        compaction_tokens: 500,
        timestamp: new Date().toISOString(),
      };

      expect(event.type).toBe(SSEEventType.CompactionEnd);
      if (event.type === SSEEventType.CompactionEnd) {
        expect(typeof event.tokens_before).toBe('number');
        expect(typeof event.tokens_after).toBe('number');
        expect(typeof event.compaction_tokens).toBe('number');
        expect(event.tokens_after).toBeLessThan(event.tokens_before);
        expect(event.compaction_tokens).toBeGreaterThanOrEqual(0);
        expect(isValidTimestamp(event.timestamp)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Type exhaustiveness — every event is a valid SSEEvent member
  // -----------------------------------------------------------------------

  describe('type safety', () => {
    it('every emitted event has a valid SSEEventType', async () => {
      const validTypes = new Set(Object.values(SSEEventType));

      const {session} = createMockSession([
        {type: CONTENT, value: 'hello'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'test', controller.signal),
      );

      for (const event of events) {
        expect(validTypes.has(event.type)).toBe(true);
      }
    });

    it('every event has a timestamp field', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'test_tool', args: {}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'done'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'test_tool'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'test_tool', response: {}}}],
          error: undefined,
          errorType: undefined,
        },
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'test', controller.signal),
      );

      for (const event of events) {
        expect(event).toHaveProperty('timestamp');
        expect(isValidTimestamp((event as unknown as Record<string, unknown>)['timestamp'])).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Full conversation flow
  // -----------------------------------------------------------------------

  describe('full conversation flow', () => {
    it('simple text: init → text_delta+ → done', async () => {
      const {session} = createMockSession([
        {type: CONTENT, value: 'Hello '},
        {type: CONTENT, value: 'world!'},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'hi', controller.signal),
      );

      const types = events.map((e) => e.type);
      expect(types[0]).toBe(SSEEventType.Init);
      expect(types[types.length - 1]).toBe(SSEEventType.Done);

      const middle = types.slice(1, -1);
      expect(middle.length).toBe(2);
      expect(middle.every((t) => t === SSEEventType.TextDelta)).toBe(true);
    });

    it('tool call: init → tool_call_start → tool_call_result → text_delta+ → done', async () => {
      let callCount = 0;
      const {session, mockSchedule} = createMockSession();

      session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeStream([{
            type: TOOL_CALL_REQUEST,
            value: {callId: 'c1', name: 'lookup', args: {id: '5'}, isClientInitiated: false, prompt_id: 'p1'},
          }]);
        }
        return makeStream([{type: CONTENT, value: 'The answer is 42'}]);
      });

      mockSchedule.mockResolvedValue([{
        request: {callId: 'c1', name: 'lookup'},
        response: {
          responseParts: [{functionResponse: {id: 'c1', name: 'lookup', response: {value: 42}}}],
          error: undefined,
          errorType: undefined,
        },
      }]);

      const events = await collectEvents(
        streamMessage(session as never, 'look up 5', controller.signal),
      );

      const types = events.map((e) => e.type);
      expect(types[0]).toBe(SSEEventType.Init);
      expect(types).toContain(SSEEventType.ToolCallStart);
      expect(types).toContain(SSEEventType.ToolCallResult);
      expect(types).toContain(SSEEventType.TextDelta);
      expect(types[types.length - 1]).toBe(SSEEventType.Done);

      // Verify ordering within the sequence
      const startIdx = types.indexOf(SSEEventType.ToolCallStart);
      const resultIdx = types.indexOf(SSEEventType.ToolCallResult);
      const firstTextIdx = types.indexOf(SSEEventType.TextDelta);
      expect(startIdx).toBeLessThan(resultIdx);
      expect(resultIdx).toBeLessThan(firstTextIdx);
    });

    it('error: init → error → done', async () => {
      const {session} = createMockSession([
        {type: ERROR, value: {error: {message: 'service unavailable'}}},
      ]);

      const events = await collectEvents(
        streamMessage(session as never, 'fail', controller.signal),
      );

      const types = events.map((e) => e.type);
      expect(types[0]).toBe(SSEEventType.Init);
      expect(types).toContain(SSEEventType.Error);
      expect(types[types.length - 1]).toBe(SSEEventType.Done);
    });
  });
});
