/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEEventType } from '../types.js';

// Use string constants to avoid importing the enum from core
const CONTENT = 'content';
const TOOL_CALL_REQUEST = 'tool_call_request';
const ERROR = 'error';
const AGENT_EXECUTION_STOPPED = 'agent_execution_stopped';

const ASK_USER = 'ask_user';

vi.mock('@amodalai/core', () => ({
  GeminiEventType: {
    Content: CONTENT,
    ToolCallRequest: TOOL_CALL_REQUEST,
    Error: ERROR,
    AgentExecutionStopped: AGENT_EXECUTION_STOPPED,
  },
  ToolErrorType: {
    STOP_EXECUTION: 'stop_execution',
  },
  MessageBusType: {
    SUBAGENT_ACTIVITY: 'subagent-activity',
  },
  PRESENT_TOOL_NAME: 'present',
  ACTIVATE_SKILL_TOOL_NAME: 'activate_skill',
  ASK_USER_TOOL_NAME: ASK_USER,
  SessionManager: vi.fn(),
}));

const { runMessage, streamMessage } = await import('./session-runner.js');

// Helper to create an async generator from an array of events
async function* makeStream(
  events: Array<{ type: string; value?: unknown }>,
): AsyncGenerator<{ type: string; value?: unknown }> {
  for (const event of events) {
    yield event;
  }
}

function createMockSession(streamEvents: Array<{ type: string; value?: unknown }> = []) {
  const mockSchedule = vi.fn().mockResolvedValue([]);
  const mockRecordCompletedToolCalls = vi.fn();

  return {
    session: {
      id: 'sess-123',
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
          recordCompletedToolCalls: mockRecordCompletedToolCalls,
        }),
      },
      scheduler: {
        schedule: mockSchedule,
      },
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accumulatedMessages: [],
    },
    mockSchedule,
    mockRecordCompletedToolCalls,
  };
}

describe('runMessage', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  it('returns text response from content events', async () => {
    const { session } = createMockSession([
      { type: CONTENT, value: 'Hello ' },
      { type: CONTENT, value: 'world!' },
    ]);

    const result = await runMessage(
      session as never,
      'hi',
      controller.signal,
    );

    expect(result.session_id).toBe('sess-123');
    expect(result.response).toBe('Hello world!');
    expect(result.tool_calls).toHaveLength(0);
  });

  it('handles tool calls and continues loop', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'get_info',
        args: { id: '42' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    // First call returns tool call, second returns text
    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Result: done' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'get_info' },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'get_info', response: { result: 'ok' } } },
          ],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 50,
      },
    ]);

    const result = await runMessage(
      session as never,
      'do something',
      controller.signal,
    );

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0]?.tool_name).toBe('get_info');
    expect(result.tool_calls[0]?.status).toBe('success');
    expect(result.response).toBe('Result: done');
  });

  it('stops on AgentExecutionStopped event', async () => {
    const { session } = createMockSession([
      { type: CONTENT, value: 'partial ' },
      {
        type: AGENT_EXECUTION_STOPPED,
        value: { reason: 'done', systemMessage: 'Agent stopped' },
      },
    ]);

    const result = await runMessage(
      session as never,
      'stop test',
      controller.signal,
    );

    expect(result.response).toBe('partial ');
  });

  it('throws on error events', async () => {
    const { session } = createMockSession([
      {
        type: ERROR,
        value: { error: { message: 'LLM error' } },
      },
    ]);

    await expect(
      runMessage(session as never, 'error test', controller.signal),
    ).rejects.toThrow('LLM error');
  });

  it('reports error tool calls', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'failing_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'after error' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'failing_tool' },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'failing_tool', response: { error: 'fail' } } },
          ],
          error: new Error('tool failed'),
          errorType: 'TOOL_EXECUTION_ERROR',
        },
        durationMs: 10,
      },
    ]);

    const result = await runMessage(
      session as never,
      'error tool',
      controller.signal,
    );

    expect(result.tool_calls[0]?.status).toBe('error');
    expect(result.tool_calls[0]?.error).toBe('tool failed');
  });

  it('stops on STOP_EXECUTION tool error type', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'stop_tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi
      .fn()
      .mockReturnValue(makeStream([toolCallEvent]));

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'stop_tool' },
        response: {
          responseParts: [],
          error: new Error('stopping'),
          errorType: 'stop_execution',
        },
      },
    ]);

    const result = await runMessage(
      session as never,
      'stop',
      controller.signal,
    );

    expect(result.tool_calls).toHaveLength(1);
  });

  it('logs a single session_completed audit event on success', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'get_info',
        args: { id: '42' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Done' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'get_info' },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'get_info', response: { result: 'ok' } } },
          ],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 50,
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',


      orgId: 'org-1',
    };

    await runMessage(
      session as never,
      'do something',
      controller.signal,
      audit as never,
    );

    expect(mockLog).toHaveBeenCalledOnce();
    const [appId, token, entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(appId).toBe('app-1');
    expect(token).toBe('tok-1');
    expect(entry['event']).toBe('session_completed');
    expect(entry['resource_name']).toBe('sess-123');
    const details = entry['details'] as Record<string, unknown>;
    expect(details['status']).toBe('completed');
    expect(details['message']).toBe('do something');
    expect(details['response']).toBe('Done');
    expect(details['app_id']).toBe('app-1');
    expect(details['org_id']).toBe('org-1');
    expect(details['turns']).toBe(2);
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.['tool_name']).toBe('get_info');
    expect(toolCalls[0]?.['status']).toBe('success');
  });

  it('captures tool result text in audit log', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'shell_exec',
        args: { command: 'curl http://api/devices' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Got it' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'shell_exec' },
        response: {
          responseParts: [
            { text: '{"devices": [{"id": "d1", "name": "sensor-001"}]}' },
          ],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 120,
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await runMessage(
      session as never,
      'list devices',
      controller.signal,
      audit as never,
    );

    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    const details = entry['details'] as Record<string, unknown>;
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    expect(toolCalls[0]?.['result']).toBe('{"devices": [{"id": "d1", "name": "sensor-001"}]}');
  });

  it('captures functionResponse result from task agents in audit log', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'environment_scanner',
        args: {},
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Scanned' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'environment_scanner', args: {} },
        response: {
          responseParts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'environment_scanner',
                response: { summary: 'No anomalies detected', devices_scanned: 42 },
              },
            },
          ],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 20000,
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await runMessage(
      session as never,
      'scan environment',
      controller.signal,
      audit as never,
    );

    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    const details = entry['details'] as Record<string, unknown>;
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    expect(toolCalls[0]?.['result']).toBe('{"summary":"No anomalies detected","devices_scanned":42}');
  });

  it('truncates long tool result text in audit log', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'shell_exec',
        args: { command: 'curl http://api/big-response' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Got it' }]);
    });

    const longText = 'x'.repeat(3000);
    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'shell_exec' },
        response: {
          responseParts: [{ text: longText }],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 200,
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await runMessage(
      session as never,
      'big query',
      controller.signal,
      audit as never,
    );

    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    const details = entry['details'] as Record<string, unknown>;
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    const result = toolCalls[0]?.['result'] as string;
    expect(result).toHaveLength(2000 + '...[truncated]'.length);
    expect(result).toContain('...[truncated]');
  });

  it('logs session_completed with error status on throw', async () => {
    const { session } = createMockSession([
      {
        type: ERROR,
        value: { error: { message: 'LLM error' } },
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await expect(
      runMessage(session as never, 'fail', controller.signal, audit as never),
    ).rejects.toThrow('LLM error');

    expect(mockLog).toHaveBeenCalledOnce();
    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(entry['event']).toBe('session_completed');
    const details = entry['details'] as Record<string, unknown>;
    expect(details['status']).toBe('error');
    expect(details['error']).toBe('LLM error');
  });
});

describe('streamMessage', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  async function collectEvents(
    gen: AsyncGenerator<unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const events: Array<Record<string, unknown>> = [];
    for await (const event of gen) {
      events.push(event as Record<string, unknown>);
    }
    return events;
  }

  it('yields init event first', async () => {
    const { session } = createMockSession([
      { type: CONTENT, value: 'hi' },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'hello', controller.signal),
    );

    expect(events[0]?.['type']).toBe(SSEEventType.Init);
    expect(events[0]?.['session_id']).toBe('sess-123');
  });

  it('yields text delta events', async () => {
    const { session } = createMockSession([
      { type: CONTENT, value: 'Hello ' },
      { type: CONTENT, value: 'world!' },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'hi', controller.signal),
    );

    const textEvents = events.filter(
      (e) => e['type'] === SSEEventType.TextDelta,
    );
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0]?.['content']).toBe('Hello ');
    expect(textEvents[1]?.['content']).toBe('world!');
  });

  it('yields done event at the end', async () => {
    const { session } = createMockSession([
      { type: CONTENT, value: 'done' },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'hi', controller.signal),
    );

    const lastEvent = events[events.length - 1];
    expect(lastEvent?.['type']).toBe(SSEEventType.Done);
  });

  it('yields tool call start and result events', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'get_info',
        args: { q: 'test' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'result' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'get_info' },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'get_info', response: {} } },
          ],
          error: undefined,
          errorType: undefined,
        },
      },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'do it', controller.signal),
    );

    const toolStart = events.find(
      (e) => e['type'] === SSEEventType.ToolCallStart,
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.['tool_name']).toBe('get_info');

    const toolResult = events.find(
      (e) => e['type'] === SSEEventType.ToolCallResult,
    );
    expect(toolResult).toBeDefined();
    expect(toolResult?.['status']).toBe('success');
  });

  it('yields error event on LLM error', async () => {
    const { session } = createMockSession([
      {
        type: ERROR,
        value: { error: { message: 'boom' } },
      },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'fail', controller.signal),
    );

    const errorEvent = events.find(
      (e) => e['type'] === SSEEventType.Error,
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.['message']).toBe('boom');
  });

  it('yields skill_activated event when activate_skill tool succeeds', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'activate_skill',
        args: { name: 'triage' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'skill loaded' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'activate_skill', args: { name: 'triage' } },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'activate_skill', response: { result: 'ok' } } },
          ],
          error: undefined,
          errorType: undefined,
        },
      },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'triage please', controller.signal),
    );

    const skillEvent = events.find(
      (e) => e['type'] === SSEEventType.SkillActivated,
    );
    expect(skillEvent).toBeDefined();
    expect(skillEvent?.['skill_name']).toBe('triage');
  });

  it('logs a single session_completed audit event with tool calls and skills', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'activate_skill',
        args: { name: 'triage' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'skill loaded' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'activate_skill', args: { name: 'triage' } },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'activate_skill', response: { result: 'ok' } } },
          ],
          error: undefined,
          errorType: undefined,
        },
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',


      orgId: 'org-1',
    };

    await collectEvents(
      streamMessage(session as never, 'triage please', controller.signal, audit as never),
    );

    expect(mockLog).toHaveBeenCalledOnce();
    const [appId, token, entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(appId).toBe('app-1');
    expect(token).toBe('tok-1');
    expect(entry['event']).toBe('session_completed');
    expect(entry['resource_name']).toBe('sess-123');
    const details = entry['details'] as Record<string, unknown>;
    expect(details['status']).toBe('completed');
    expect(details['message']).toBe('triage please');
    expect(details['response']).toBe('skill loaded');
    expect(details['app_id']).toBe('app-1');
    expect(details['org_id']).toBe('org-1');
    expect(details['skills_activated']).toEqual(['triage']);
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.['tool_name']).toBe('activate_skill');
  });

  it('captures tool result text in streamed audit log', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'shell_exec',
        args: { command: 'curl http://api/alerts' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Analyzed alerts' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'shell_exec' },
        response: {
          responseParts: [
            { text: '{"alerts": [{"severity": "high", "message": "anomaly detected"}]}' },
          ],
          error: undefined,
          errorType: undefined,
        },
        durationMs: 80,
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await collectEvents(
      streamMessage(session as never, 'check alerts', controller.signal, audit as never),
    );

    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    const details = entry['details'] as Record<string, unknown>;
    const toolCalls = details['tool_calls'] as Array<Record<string, unknown>>;
    expect(toolCalls[0]?.['result']).toBe('{"alerts": [{"severity": "high", "message": "anomaly detected"}]}');
  });

  it('logs session_completed with error status on LLM error', async () => {
    const { session } = createMockSession([
      {
        type: ERROR,
        value: { error: { message: 'boom' } },
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await collectEvents(
      streamMessage(session as never, 'fail', controller.signal, audit as never),
    );

    expect(mockLog).toHaveBeenCalledOnce();
    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(entry['event']).toBe('session_completed');
    const details = entry['details'] as Record<string, unknown>;
    expect(details['status']).toBe('error');
    expect(details['error']).toBe('boom');
  });

  it('logs session_completed with max_turns status', async () => {
    const { session } = createMockSession();

    // Always return a tool call to keep the loop going — must create fresh stream each time
    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() =>
      makeStream([{
        type: TOOL_CALL_REQUEST,
        value: {
          callId: 'call-1',
          name: 'get_info',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
      }]),
    );
    session.scheduler.schedule = vi.fn().mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'get_info' },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'get_info', response: {} } },
          ],
          error: undefined,
          errorType: undefined,
        },
      },
    ]);

    const mockLog = vi.fn();
    const audit = {
      auditClient: { log: mockLog },
      appId: 'app-1',
      token: 'tok-1',
    };

    await collectEvents(
      streamMessage(session as never, 'loop forever', controller.signal, audit as never),
    );

    expect(mockLog).toHaveBeenCalledOnce();
    const [, , entry] = mockLog.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(entry['event']).toBe('session_completed');
    const details = entry['details'] as Record<string, unknown>;
    expect(details['status']).toBe('max_turns');
    expect(details['error']).toBe('Maximum turns exceeded');
  });

  it('intercepts ask_user tool calls and yields ask_user event', async () => {
    const askUserEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'ask-1',
        name: ASK_USER,
        args: {
          questions: [
            { question: 'Which zone?', header: 'Zone', type: 'choice', options: [{ label: 'A', description: 'Zone A' }, { label: 'B', description: 'Zone B' }] },
          ],
        },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([askUserEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Great, Zone A!' }]);
    });

    // Create a mock SessionManager that resolves the ask_user
    const mockSessionManager = {
      waitForAskUserResponse: vi.fn().mockResolvedValue({ '0': 'A' }),
      resolveAskUser: vi.fn().mockReturnValue(true),
    };

    const events = await collectEvents(
      streamMessage(
        session as never,
        'choose zone',
        controller.signal,
        undefined,
        mockSessionManager as never,
      ),
    );

    // Should have an ask_user event
    const askEvent = events.find(
      (e) => e['type'] === SSEEventType.AskUser,
    );
    expect(askEvent).toBeDefined();
    expect(askEvent?.['ask_id']).toBe('ask-1');
    expect(askEvent?.['questions']).toHaveLength(1);

    // Should have tool_call_start and tool_call_result for ask_user
    const toolStart = events.find(
      (e) => e['type'] === SSEEventType.ToolCallStart && e['tool_name'] === ASK_USER,
    );
    expect(toolStart).toBeDefined();

    const toolResult = events.find(
      (e) => e['type'] === SSEEventType.ToolCallResult && e['tool_id'] === 'ask-1',
    );
    expect(toolResult).toBeDefined();
    expect(toolResult?.['status']).toBe('success');

    // Should continue with text response
    const textEvents = events.filter(
      (e) => e['type'] === SSEEventType.TextDelta,
    );
    expect(textEvents.length).toBeGreaterThan(0);

    // waitForAskUserResponse should have been called
    expect(mockSessionManager.waitForAskUserResponse).toHaveBeenCalledWith(
      session,
      'ask-1',
      controller.signal,
    );
  });

  it('handles ask_user timeout gracefully', async () => {
    const askUserEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'ask-timeout',
        name: ASK_USER,
        args: {
          questions: [{ question: 'Answer?', header: 'Q', type: 'text' }],
        },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([askUserEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'Timed out' }]);
    });

    const mockSessionManager = {
      waitForAskUserResponse: vi.fn().mockRejectedValue(new Error('ask_user response timed out')),
    };

    const events = await collectEvents(
      streamMessage(
        session as never,
        'question',
        controller.signal,
        undefined,
        mockSessionManager as never,
      ),
    );

    // Should have error result for the ask_user tool call
    const toolResult = events.find(
      (e) => e['type'] === SSEEventType.ToolCallResult && e['tool_id'] === 'ask-timeout',
    );
    expect(toolResult).toBeDefined();
    expect(toolResult?.['status']).toBe('error');
    expect(toolResult?.['error']).toBe('ask_user response timed out');
  });

  it('does not yield skill_activated when activate_skill tool fails', async () => {
    const toolCallEvent = {
      type: TOOL_CALL_REQUEST,
      value: {
        callId: 'call-1',
        name: 'activate_skill',
        args: { name: 'nonexistent' },
        isClientInitiated: false,
        prompt_id: 'p1',
      },
    };

    let callCount = 0;
    const { session, mockSchedule } = createMockSession();

    session.geminiClient.sendMessageStream = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([toolCallEvent]);
      }
      return makeStream([{ type: CONTENT, value: 'failed' }]);
    });

    mockSchedule.mockResolvedValue([
      {
        request: { callId: 'call-1', name: 'activate_skill', args: { name: 'nonexistent' } },
        response: {
          responseParts: [
            { functionResponse: { id: 'call-1', name: 'activate_skill', response: { error: 'not found' } } },
          ],
          error: new Error('Skill not found'),
          errorType: 'TOOL_EXECUTION_ERROR',
        },
      },
    ]);

    const events = await collectEvents(
      streamMessage(session as never, 'bad skill', controller.signal),
    );

    const skillEvent = events.find(
      (e) => e['type'] === SSEEventType.SkillActivated,
    );
    expect(skillEvent).toBeUndefined();
  });
});
