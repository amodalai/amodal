/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import http from 'node:http';
import {chatReducer, initialState} from './useChat.js';
import type {ChatState, ChatAction} from './types.js';

// ---------------------------------------------------------------------------
// Mock SSE server — simulates the runtime /chat endpoint
// ---------------------------------------------------------------------------

function createMockSSEServer(
  eventsFn: () => Array<Record<string, unknown>>,
): http.Server {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat') {
      // Drain request body
      let _body = '';
      req.on('data', (chunk: Buffer) => {
        _body += chunk.toString();
      });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const events = eventsFn();
        for (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

/**
 * Send a chat message to a mock server, collecting all dispatched actions.
 */
function sendChatAndCollectActions(
  port: number,
  message: string,
): Promise<ChatAction[]> {
  return new Promise((resolve, reject) => {
    const actions: ChatAction[] = [];
    const body = JSON.stringify({message, tenant_id: 'test'});

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
               
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const action = sseEventToAction(event);
              if (action) actions.push(action);
            } catch {
              // skip
            }
          }
        });

        res.on('end', () => {
          // Process remaining buffer (same as useChat.ts safety net)
          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('data: ')) {
              try {
                 
                const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
                const action = sseEventToAction(event);
                if (action) actions.push(action);
              } catch {
                // skip
              }
            }
          }
          // Safety net DONE
          actions.push({type: 'DONE'});
          resolve(actions);
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Map SSE event to ChatAction (mirrors handleSSEEvent in useChat.ts).
 */
function sseEventToAction(event: Record<string, unknown>): ChatAction | null {
  switch (event['type']) {
    case 'init':
      return {type: 'INIT', sessionId: String(event['session_id'])};
    case 'text_delta':
      return {type: 'TEXT_DELTA', content: String(event['content'] ?? '')};
    case 'thinking_delta':
      return {type: 'THINKING_DELTA', content: String(event['content'] ?? '')};
    case 'tool_call_start':
      return {
        type: 'TOOL_CALL_START',
        toolId: String(event['tool_id'] ?? event['tool_name']),
        toolName: String(event['tool_name']),
         
        args: (event['parameters'] as Record<string, unknown>) ?? {},
      };
    case 'tool_call_result':
      return {
        type: 'TOOL_CALL_RESULT',
        toolId: String(event['tool_id'] ?? event['tool_name']),
        status: event['status'] === 'error' ? 'error' : 'success',
        result: event['result'] ? String(event['result']) : undefined,
        error: event['error'] ? String(event['error']) : undefined,
        durationMs: typeof event['duration_ms'] === 'number' ? event['duration_ms'] : undefined,
      };
    case 'skill_activated':
      return {type: 'SKILL_ACTIVATED', skillName: String(event['skill_name'])};
    case 'token_usage':
      return {
        type: 'TOKEN_USAGE',
        inputTokens: typeof event['input_tokens'] === 'number' ? event['input_tokens'] : 0,
        outputTokens: typeof event['output_tokens'] === 'number' ? event['output_tokens'] : 0,
        model: typeof event['model'] === 'string' ? event['model'] : undefined,
      };
    case 'error':
      return {type: 'ERROR', message: String(event['message'])};
    case 'done':
      return {type: 'DONE'};
    default:
      return null;
  }
}

/**
 * Replay actions through the reducer and return final state.
 */
function replayActions(actions: ChatAction[]): ChatState {
  // Start with SEND_MESSAGE to simulate user sending a message
  let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hello'});
  for (const action of actions) {
    state = chatReducer(state, action);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat E2E: SSE → Reducer integration', () => {
  let server: http.Server;
  let port: number;
  let serverEvents: Array<Record<string, unknown>>;

  beforeAll(async () => {
    serverEvents = [];
    server = createMockSSEServer(() => serverEvents);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('processes a simple text response with init + text + done', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-001', timestamp: new Date().toISOString()},
      {type: 'text_delta', content: 'Hello, '},
      {type: 'text_delta', content: 'world!'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'hi');
    const state = replayActions(actions);

    expect(state.sessionId).toBe('sess-001');
    expect(state.isStreaming).toBe(false);
    expect(state.messages).toHaveLength(2); // user + assistant
    expect(state.messages[0]?.role).toBe('user');
    expect(state.messages[1]?.role).toBe('assistant');
    expect(state.messages[1]?.text).toBe('Hello, world!');
  });

  it('processes response with tool calls', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-002', timestamp: new Date().toISOString()},
      {type: 'tool_call_start', tool_name: 'request', tool_id: 't1', parameters: {url: '/api/test'}},
      {type: 'tool_call_result', tool_id: 't1', status: 'success', result: '{"ok":true}', duration_ms: 150},
      {type: 'text_delta', content: 'The API returned OK.'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'check api');
    const state = replayActions(actions);

    expect(state.isStreaming).toBe(false);
    expect(state.messages).toHaveLength(2);

    const assistant = state.messages[1];
    expect(assistant?.text).toBe('The API returned OK.');
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(assistant?.toolCalls?.[0]?.toolName).toBe('request');
    expect(assistant?.toolCalls?.[0]?.status).toBe('success');
    expect(assistant?.toolCalls?.[0]?.durationMs).toBe(150);
  });

  it('processes response with token_usage event', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-003', timestamp: new Date().toISOString()},
      {type: 'text_delta', content: 'Answer.'},
      {type: 'token_usage', input_tokens: 500, output_tokens: 120, model: 'claude-sonnet-4'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'test');
    const state = replayActions(actions);

    expect(state.tokenUsage.totalInputTokens).toBe(500);
    expect(state.tokenUsage.totalOutputTokens).toBe(120);
    expect(state.tokenUsage.totalTokens).toBe(620);
    expect(state.tokenUsage.model).toBe('claude-sonnet-4');
    expect(state.tokenUsage.turnCount).toBe(1);
  });

  it('handles done event correctly — does not produce empty response', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-004', timestamp: new Date().toISOString()},
      {type: 'text_delta', content: 'Non-empty response.'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'test');
    const state = replayActions(actions);

    // Should have exactly 2 messages (user + assistant)
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('Non-empty response.');

    // The safety-net DONE at the end should be idempotent (no extra message)
    expect(state.isStreaming).toBe(false);
  });

  it('safety-net DONE does not create duplicate assistant message', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-005', timestamp: new Date().toISOString()},
      {type: 'text_delta', content: 'First response.'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'test');

    // Should have: INIT, TEXT_DELTA, DONE (from server), DONE (safety net)
    const doneCount = actions.filter((a) => a.type === 'DONE').length;
    expect(doneCount).toBe(2); // server done + safety net done

    const state = replayActions(actions);
    // Only 2 messages despite 2 DONE dispatches
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('First response.');
  });

  it('handles error followed by done', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-006', timestamp: new Date().toISOString()},
      {type: 'error', message: 'LLM provider timeout'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'test');
    const state = replayActions(actions);

    // ERROR sets isStreaming=false, so DONE from server is ignored
    // Then safety-net DONE is also ignored
    expect(state.isStreaming).toBe(false);
    expect(state.error).toBe('LLM provider timeout');
  });

  it('handles server that sends no done event', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-007', timestamp: new Date().toISOString()},
      {type: 'text_delta', content: 'Response without done.'},
      // No done event — server just ends the stream
    ];

    const actions = await sendChatAndCollectActions(port, 'test');
    const state = replayActions(actions);

    // The safety-net DONE should finalize the response
    expect(state.isStreaming).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('Response without done.');
  });

  it('handles multi-turn with skills', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-008', timestamp: new Date().toISOString()},
      {type: 'skill_activated', skill_name: 'triage'},
      {type: 'text_delta', content: 'Analyzing with triage skill.'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'investigate');
    const state = replayActions(actions);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.skills).toContain('triage');
    expect(state.messages[1]?.text).toBe('Analyzing with triage skill.');
  });

  it('handles thinking + text response', async () => {
    serverEvents = [
      {type: 'init', session_id: 'sess-009', timestamp: new Date().toISOString()},
      {type: 'thinking_delta', content: 'Let me analyze...'},
      {type: 'text_delta', content: 'Here is the answer.'},
      {type: 'done', timestamp: new Date().toISOString()},
    ];

    const actions = await sendChatAndCollectActions(port, 'think');
    const state = replayActions(actions);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('Here is the answer.');
    expect(state.messages[1]?.thinking).toBe('Let me analyze...');
  });

  it('processes large chunked response correctly', async () => {
    // Simulate many small text deltas
    const events: Array<Record<string, unknown>> = [
      {type: 'init', session_id: 'sess-010', timestamp: new Date().toISOString()},
    ];
    const words = 'The quick brown fox jumps over the lazy dog'.split(' ');
    for (const word of words) {
      events.push({type: 'text_delta', content: word + ' '});
    }
    events.push({type: 'done', timestamp: new Date().toISOString()});
    serverEvents = events;

    const actions = await sendChatAndCollectActions(port, 'test');
    const state = replayActions(actions);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('The quick brown fox jumps over the lazy dog ');
    expect(state.isStreaming).toBe(false);
  });
});

describe('Chat E2E: Multi-turn SSE', () => {
  let server: http.Server;
  let port: number;
  let turnCounter: number;

  beforeAll(async () => {
    turnCounter = 0;
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat') {
        let _body = '';
        req.on('data', (chunk: Buffer) => {
          _body += chunk.toString();
        });
        req.on('end', () => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          turnCounter++;
          const turn = turnCounter;
          res.write(`data: ${JSON.stringify({type: 'init', session_id: 'multi-sess', timestamp: new Date().toISOString()})}\n\n`);
          res.write(`data: ${JSON.stringify({type: 'text_delta', content: `Response ${turn}`})}\n\n`);
          res.write(`data: ${JSON.stringify({type: 'done', timestamp: new Date().toISOString()})}\n\n`);
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('three consecutive turns produce correct non-empty messages', async () => {
    // Simulate 3 turns by sending 3 requests sequentially
    const allActions: ChatAction[][] = [];

    for (let i = 0; i < 3; i++) {
      const actions = await sendChatAndCollectActions(port, `question ${i + 1}`);
      allActions.push(actions);
    }

    // Replay all turns through the reducer
    let state = initialState;
    for (let i = 0; i < 3; i++) {
      state = chatReducer(state, {type: 'SEND_MESSAGE', text: `question ${i + 1}`});
      for (const action of allActions[i] ?? []) {
        state = chatReducer(state, action);
      }
    }

    // Should have 6 messages: 3 user + 3 assistant
    expect(state.messages).toHaveLength(6);

    // All assistant messages should have non-empty text
    for (let i = 0; i < 3; i++) {
      const userMsg = state.messages[i * 2];
      const assistantMsg = state.messages[i * 2 + 1];
      expect(userMsg?.role).toBe('user');
      expect(userMsg?.text).toBe(`question ${i + 1}`);
      expect(assistantMsg?.role).toBe('assistant');
      expect(assistantMsg?.text).toBe(`Response ${i + 1}`);
      expect(assistantMsg?.text.length).toBeGreaterThan(0);
    }
  });

  it('safety-net DONE does not leak across turns', async () => {
    // This tests the specific race condition:
    // Request 1's end handler fires after SEND_MESSAGE for request 2
    let state = initialState;

    // Turn 1: normal flow
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'q1'});
    state = chatReducer(state, {type: 'INIT', sessionId: 'sess-race'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Answer 1'});
    state = chatReducer(state, {type: 'DONE'}); // server's done
    expect(state.messages).toHaveLength(2);
    expect(state.isStreaming).toBe(false);

    // Turn 2: user sends immediately
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'q2'});
    expect(state.isStreaming).toBe(true);

    // If the safety-net DONE from request 1's end handler fires NOW,
    // it would create an empty assistant message. The fix prevents this
    // by using doneDispatched flag per-request in streamToServer.
    // But in the reducer, DONE when isStreaming=true DOES create a message.
    // So the fix must be in streamToServer, not the reducer.

    // Simulate request 1's delayed end handler dispatching DONE
    // With the fix, this shouldn't happen. But let's verify the reducer
    // would create an empty message if it did:
    const badState = chatReducer(state, {type: 'DONE'});
    // This WOULD create an empty message - that's the bug the dispatchOnce fixes
    expect(badState.messages).toHaveLength(4); // user, assistant, user, EMPTY assistant
    expect(badState.messages[3]?.text).toBe(''); // empty!

    // Now continue turn 2 properly (without the stale DONE)
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Answer 2'});
    state = chatReducer(state, {type: 'DONE'}); // server's done for request 2
    expect(state.messages).toHaveLength(4);
    expect(state.messages[3]?.text).toBe('Answer 2');
    expect(state.messages[3]?.text.length).toBeGreaterThan(0);
  });
});

describe('Chat E2E: Reducer direct — edge cases', () => {
  it('DONE when not streaming is no-op', () => {
    const state = chatReducer(initialState, {type: 'DONE'});
    expect(state).toBe(initialState);
    expect(state.messages).toHaveLength(0);
  });

  it('multiple rapid SEND_MESSAGE + DONE cycles produce correct message count', () => {
    let state = initialState;

    // Turn 1
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'q1'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'a1'});
    state = chatReducer(state, {type: 'DONE'});
    state = chatReducer(state, {type: 'DONE'}); // safety net duplicate
    expect(state.messages).toHaveLength(2);

    // Turn 2
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'q2'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'a2'});
    state = chatReducer(state, {type: 'DONE'});
    state = chatReducer(state, {type: 'DONE'}); // safety net duplicate
    expect(state.messages).toHaveLength(4);

    expect(state.messages[0]?.text).toBe('q1');
    expect(state.messages[1]?.text).toBe('a1');
    expect(state.messages[2]?.text).toBe('q2');
    expect(state.messages[3]?.text).toBe('a2');
  });

  it('CLEAR_HISTORY + new turn works correctly', () => {
    let state = initialState;

    // Turn 1
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'old'});
    state = chatReducer(state, {type: 'INIT', sessionId: 'sess-1'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'old response'});
    state = chatReducer(state, {type: 'DONE'});
    expect(state.messages).toHaveLength(2);

    // Clear
    state = chatReducer(state, {type: 'CLEAR_HISTORY'});
    expect(state.messages).toHaveLength(0);
    expect(state.sessionId).toBe('sess-1'); // preserved

    // Turn 2
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'new'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'new response'});
    state = chatReducer(state, {type: 'DONE'});
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('new response');
  });

  it('confirmation queue processes in FIFO order', () => {
    let state = initialState;

    const req1 = {endpoint: '/a', method: 'POST', reason: 'r1', escalated: false};
    const req2 = {endpoint: '/b', method: 'DELETE', reason: 'r2', escalated: true};
    const req3 = {endpoint: '/c', method: 'PUT', reason: 'r3', escalated: false};

    state = chatReducer(state, {type: 'CONFIRMATION_REQUIRED', request: req1});
    state = chatReducer(state, {type: 'CONFIRMATION_REQUIRED', request: req2});
    state = chatReducer(state, {type: 'CONFIRMATION_REQUIRED', request: req3});
    expect(state.confirmationQueue).toHaveLength(3);
    expect(state.pendingConfirmation).toEqual(req1);

    // Approve first
    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: true});
    expect(state.confirmationQueue).toHaveLength(2);
    expect(state.pendingConfirmation).toEqual(req2);

    // Reject second
    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: false});
    expect(state.confirmationQueue).toHaveLength(1);
    expect(state.pendingConfirmation).toEqual(req3);

    // Approve third
    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: true});
    expect(state.confirmationQueue).toHaveLength(0);
    expect(state.pendingConfirmation).toBeNull();
  });
});
