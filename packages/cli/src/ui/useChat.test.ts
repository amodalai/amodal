/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {chatReducer, initialState} from './useChat.js';
import type {ChatState} from './types.js';

describe('chatReducer', () => {
  it('handles SEND_MESSAGE', () => {
    const state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hello'});
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe('user');
    expect(state.messages[0]?.text).toBe('hello');
    expect(state.isStreaming).toBe(true);
    expect(state.streamingText).toBe('');
    expect(state.thinkingText).toBe('');
  });

  it('handles INIT', () => {
    const state = chatReducer(initialState, {type: 'INIT', sessionId: 'sess-1'});
    expect(state.sessionId).toBe('sess-1');
  });

  it('handles TEXT_DELTA — appends to streamingText', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Hello '});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'world'});
    expect(state.streamingText).toBe('Hello world');
  });

  it('handles THINKING_DELTA — appends to thinkingText', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'THINKING_DELTA', content: 'Analyzing '});
    state = chatReducer(state, {type: 'THINKING_DELTA', content: 'the data'});
    expect(state.thinkingText).toBe('Analyzing the data');
  });

  it('handles TOOL_CALL_START', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {
      type: 'TOOL_CALL_START',
      toolId: 't1',
      toolName: 'request',
      args: {url: '/api/test'},
    });
    expect(state.activeToolCalls).toHaveLength(1);
    expect(state.activeToolCalls[0]?.toolName).toBe('request');
    expect(state.activeToolCalls[0]?.status).toBe('running');
  });

  it('handles TOOL_CALL_RESULT — updates matching tool', () => {
    let state: ChatState = {
      ...initialState,
      isStreaming: true,
      activeToolCalls: [
        {toolId: 't1', toolName: 'request', args: {}, status: 'running'},
      ],
    };
    state = chatReducer(state, {
      type: 'TOOL_CALL_RESULT',
      toolId: 't1',
      status: 'success',
      result: '{"ok": true}',
      durationMs: 245,
    });
    expect(state.activeToolCalls[0]?.status).toBe('success');
    expect(state.activeToolCalls[0]?.result).toBe('{"ok": true}');
    expect(state.activeToolCalls[0]?.durationMs).toBe(245);
  });

  it('handles TOOL_CALL_RESULT error', () => {
    let state: ChatState = {
      ...initialState,
      isStreaming: true,
      activeToolCalls: [
        {toolId: 't1', toolName: 'request', args: {}, status: 'running'},
      ],
    };
    state = chatReducer(state, {
      type: 'TOOL_CALL_RESULT',
      toolId: 't1',
      status: 'error',
      error: 'timeout',
    });
    expect(state.activeToolCalls[0]?.status).toBe('error');
    expect(state.activeToolCalls[0]?.error).toBe('timeout');
  });

  it('handles SUBAGENT_EVENT', () => {
    let state: ChatState = {
      ...initialState,
      isStreaming: true,
      activeToolCalls: [
        {toolId: 't1', toolName: 'dispatch', args: {}, status: 'running', subagentEvents: []},
      ],
    };
    state = chatReducer(state, {
      type: 'SUBAGENT_EVENT',
      parentToolId: 't1',
      agentName: 'triage-agent',
      eventType: 'tool_call',
      toolName: 'request',
    });
    expect(state.activeToolCalls[0]?.subagentEvents).toHaveLength(1);
    expect(state.activeToolCalls[0]?.subagentEvents?.[0]?.agentName).toBe('triage-agent');
  });

  it('handles SKILL_ACTIVATED', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'SKILL_ACTIVATED', skillName: 'triage'});
    expect(state.activatedSkills).toContain('triage');
  });

  it('handles ERROR', () => {
    const state = chatReducer(initialState, {type: 'ERROR', message: 'connection refused'});
    expect(state.error).toBe('connection refused');
    expect(state.isStreaming).toBe(false);
  });

  it('handles DONE — finalizes assistant message', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Hello!'});
    state = chatReducer(state, {type: 'SKILL_ACTIVATED', skillName: 'triage'});
    state = chatReducer(state, {
      type: 'TOOL_CALL_START',
      toolId: 't1',
      toolName: 'request',
      args: {},
    });
    state = chatReducer(state, {
      type: 'TOOL_CALL_RESULT',
      toolId: 't1',
      status: 'success',
      result: 'ok',
    });
    state = chatReducer(state, {type: 'DONE'});

    expect(state.isStreaming).toBe(false);
    expect(state.streamingText).toBe('');
    expect(state.activeToolCalls).toHaveLength(0);
    expect(state.activatedSkills).toHaveLength(0);
    // Should have user message + assistant message
    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.text).toBe('Hello!');
    expect(assistant?.skills).toContain('triage');
    expect(assistant?.toolCalls).toHaveLength(1);
  });

  it('handles DONE with no content — creates empty assistant message', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'DONE'});
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.text).toBe('');
    expect(state.messages[1]?.toolCalls).toBeUndefined();
    expect(state.messages[1]?.skills).toBeUndefined();
  });

  it('handles DONE idempotently — second DONE is no-op', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Hello!'});
    state = chatReducer(state, {type: 'DONE'});
    expect(state.messages).toHaveLength(2);
    expect(state.isStreaming).toBe(false);

    // Second DONE should be no-op
    const stateAfterSecondDone = chatReducer(state, {type: 'DONE'});
    expect(stateAfterSecondDone).toBe(state); // Same reference
    expect(stateAfterSecondDone.messages).toHaveLength(2);
  });

  it('preserves sessionId across turns', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'INIT', sessionId: 'sess-1'});
    state = chatReducer(state, {type: 'DONE'});
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'follow up'});
    expect(state.sessionId).toBe('sess-1');
  });

  // --- New reducer tests ---

  it('handles DONE — attaches thinking text to assistant message', () => {
    let state = chatReducer(initialState, {type: 'SEND_MESSAGE', text: 'hi'});
    state = chatReducer(state, {type: 'THINKING_DELTA', content: 'Reasoning about the problem'});
    state = chatReducer(state, {type: 'TEXT_DELTA', content: 'Here is my answer'});
    state = chatReducer(state, {type: 'DONE'});

    const assistant = state.messages[1];
    expect(assistant?.thinking).toBe('Reasoning about the problem');
    expect(assistant?.text).toBe('Here is my answer');
    expect(state.thinkingText).toBe('');
  });

  it('handles ASK_USER — sets pendingQuestion', () => {
    const state = chatReducer(initialState, {
      type: 'ASK_USER',
      askId: 'ask-1',
      questions: [{text: 'Which environment?'}],
    });
    expect(state.pendingQuestion).toEqual({
      askId: 'ask-1',
      text: 'Which environment?',
    });
  });

  it('handles ASK_USER with multiple questions — joins text', () => {
    const state = chatReducer(initialState, {
      type: 'ASK_USER',
      askId: 'ask-2',
      questions: [{text: 'Question 1'}, {text: 'Question 2'}],
    });
    expect(state.pendingQuestion?.text).toBe('Question 1\nQuestion 2');
  });

  it('handles ASK_USER_RESPOND — clears pendingQuestion', () => {
    let state: ChatState = {
      ...initialState,
      pendingQuestion: {askId: 'ask-1', text: 'Which env?'},
    };
    state = chatReducer(state, {type: 'ASK_USER_RESPOND', askId: 'ask-1', answer: 'production'});
    expect(state.pendingQuestion).toBeNull();
  });

  it('handles CONFIRMATION_REQUIRED — sets pendingConfirmation', () => {
    const state = chatReducer(initialState, {
      type: 'CONFIRMATION_REQUIRED',
      request: {
        endpoint: '/api/customers',
        method: 'POST',
        reason: 'Create new customer record',
        escalated: false,
      },
    });
    expect(state.pendingConfirmation).toEqual({
      endpoint: '/api/customers',
      method: 'POST',
      reason: 'Create new customer record',
      escalated: false,
    });
  });

  it('handles CONFIRMATION_RESPOND — clears pendingConfirmation', () => {
    let state: ChatState = {
      ...initialState,
      pendingConfirmation: {
        endpoint: '/api/customers',
        method: 'POST',
        reason: 'Create record',
        escalated: false,
      },
    };
    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: true});
    expect(state.pendingConfirmation).toBeNull();
  });

  it('handles KB_PROPOSAL — adds proposal and notification', () => {
    const state = chatReducer(initialState, {
      type: 'KB_PROPOSAL',
      proposal: {
        proposalId: 'kbp-1',
        scope: 'application',
        title: 'Updated API rate limits',
        reasoning: 'Discovered new limits during session',
        status: 'pending',
      },
    });
    expect(state.kbProposals).toHaveLength(1);
    expect(state.kbProposals[0]?.title).toBe('Updated API rate limits');
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.type).toBe('kb_proposal');
  });

  it('handles NOTIFICATION — adds notification', () => {
    const state = chatReducer(initialState, {
      type: 'NOTIFICATION',
      notification: {
        id: 'n-1',
        type: 'credential_saved',
        message: 'Credential saved for stripe',
        timestamp: 1000,
      },
    });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.message).toBe('Credential saved for stripe');
  });

  it('handles DISMISS_NOTIFICATION — removes by id', () => {
    let state: ChatState = {
      ...initialState,
      notifications: [
        {id: 'n-1', type: 'info', message: 'first', timestamp: 1000},
        {id: 'n-2', type: 'info', message: 'second', timestamp: 2000},
      ],
    };
    state = chatReducer(state, {type: 'DISMISS_NOTIFICATION', id: 'n-1'});
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.id).toBe('n-2');
  });

  it('handles EXPLORE_START — sets explore phase', () => {
    const state = chatReducer(initialState, {
      type: 'EXPLORE_START',
      query: 'API error rate patterns',
    });
    expect(state.explorePhase).toEqual({
      query: 'API error rate patterns',
      active: true,
    });
  });

  it('handles EXPLORE_END — updates explore phase', () => {
    let state: ChatState = {
      ...initialState,
      explorePhase: {query: 'API error rate', active: true},
    };
    state = chatReducer(state, {
      type: 'EXPLORE_END',
      summary: 'Found correlation with deploy',
      tokensUsed: 2400,
    });
    expect(state.explorePhase?.active).toBe(false);
    expect(state.explorePhase?.summary).toBe('Found correlation with deploy');
    expect(state.explorePhase?.tokensUsed).toBe(2400);
  });

  it('handles EXPLORE_END with no active phase — returns null', () => {
    const state = chatReducer(initialState, {
      type: 'EXPLORE_END',
      summary: 'done',
      tokensUsed: 100,
    });
    expect(state.explorePhase).toBeNull();
  });

  it('SEND_MESSAGE resets thinkingText and explorePhase', () => {
    let state: ChatState = {
      ...initialState,
      thinkingText: 'some thinking',
      explorePhase: {query: 'test', active: false, summary: 'done', tokensUsed: 100},
    };
    state = chatReducer(state, {type: 'SEND_MESSAGE', text: 'next question'});
    expect(state.thinkingText).toBe('');
    expect(state.explorePhase).toBeNull();
  });

  it('DONE resets thinkingText and explorePhase', () => {
    let state: ChatState = {
      ...initialState,
      isStreaming: true,
      thinkingText: 'was thinking',
      explorePhase: {query: 'test', active: false},
    };
    state = chatReducer(state, {type: 'DONE'});
    expect(state.thinkingText).toBe('');
    expect(state.explorePhase).toBeNull();
  });

  // --- Token usage ---

  it('handles TOKEN_USAGE — accumulates tokens', () => {
    let state = chatReducer(initialState, {
      type: 'TOKEN_USAGE',
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-sonnet-4',
    });
    expect(state.tokenUsage.totalInputTokens).toBe(100);
    expect(state.tokenUsage.totalOutputTokens).toBe(50);
    expect(state.tokenUsage.totalTokens).toBe(150);
    expect(state.tokenUsage.model).toBe('claude-sonnet-4');
    expect(state.tokenUsage.turnCount).toBe(1);

    state = chatReducer(state, {
      type: 'TOKEN_USAGE',
      inputTokens: 200,
      outputTokens: 80,
    });
    expect(state.tokenUsage.totalInputTokens).toBe(300);
    expect(state.tokenUsage.totalOutputTokens).toBe(130);
    expect(state.tokenUsage.totalTokens).toBe(430);
    expect(state.tokenUsage.model).toBe('claude-sonnet-4'); // preserved from before
    expect(state.tokenUsage.turnCount).toBe(2);
  });

  it('TOKEN_USAGE initializes to zero', () => {
    expect(initialState.tokenUsage.totalInputTokens).toBe(0);
    expect(initialState.tokenUsage.totalOutputTokens).toBe(0);
    expect(initialState.tokenUsage.totalTokens).toBe(0);
    expect(initialState.tokenUsage.model).toBeNull();
    expect(initialState.tokenUsage.turnCount).toBe(0);
  });

  // --- Session resume ---

  it('handles RESUME_SESSION — sets messages and sessionId', () => {
    const messages = [
      {id: 'r1', role: 'user' as const, text: 'hello'},
      {id: 'r2', role: 'assistant' as const, text: 'hi there'},
    ];
    const state = chatReducer(initialState, {
      type: 'RESUME_SESSION',
      sessionId: 'sess-resume',
      messages,
    });
    expect(state.sessionId).toBe('sess-resume');
    expect(state.messages).toHaveLength(2);
    expect(state.isStreaming).toBe(false);
  });

  // --- Clear history ---

  it('handles CLEAR_HISTORY — resets messages but keeps sessionId and tokenUsage', () => {
    let state: ChatState = {
      ...initialState,
      sessionId: 'sess-1',
      messages: [
        {id: 'm1', role: 'user', text: 'hello'},
        {id: 'm2', role: 'assistant', text: 'hi'},
      ],
      tokenUsage: {
        totalInputTokens: 500,
        totalOutputTokens: 200,
        totalTokens: 700,
        model: 'claude',
        turnCount: 3,
      },
    };
    state = chatReducer(state, {type: 'CLEAR_HISTORY'});
    expect(state.messages).toHaveLength(0);
    expect(state.sessionId).toBe('sess-1');
    expect(state.tokenUsage.totalTokens).toBe(700);
  });

  // --- Local message ---

  it('handles LOCAL_MESSAGE — adds a system message', () => {
    const state = chatReducer(initialState, {
      type: 'LOCAL_MESSAGE',
      text: 'Welcome! Type /help for commands.',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe('assistant');
    expect(state.messages[0]?.text).toBe('Welcome! Type /help for commands.');
  });

  // --- Confirmation queue ---

  it('handles CONFIRMATION_REQUIRED — queues confirmations', () => {
    const req1 = {endpoint: '/api/a', method: 'POST', reason: 'r1', escalated: false};
    const req2 = {endpoint: '/api/b', method: 'DELETE', reason: 'r2', escalated: true};

    let state = chatReducer(initialState, {type: 'CONFIRMATION_REQUIRED', request: req1});
    expect(state.confirmationQueue).toHaveLength(1);
    expect(state.pendingConfirmation).toEqual(req1);

    state = chatReducer(state, {type: 'CONFIRMATION_REQUIRED', request: req2});
    expect(state.confirmationQueue).toHaveLength(2);
    // pendingConfirmation stays as first
    expect(state.pendingConfirmation).toEqual(req1);
  });

  it('handles CONFIRMATION_RESPOND — shifts from queue', () => {
    const req1 = {endpoint: '/api/a', method: 'POST', reason: 'r1', escalated: false};
    const req2 = {endpoint: '/api/b', method: 'DELETE', reason: 'r2', escalated: true};

    let state: ChatState = {
      ...initialState,
      pendingConfirmation: req1,
      confirmationQueue: [req1, req2],
    };
    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: true});
    expect(state.confirmationQueue).toHaveLength(1);
    expect(state.pendingConfirmation).toEqual(req2);

    state = chatReducer(state, {type: 'CONFIRMATION_RESPOND', approved: false});
    expect(state.confirmationQueue).toHaveLength(0);
    expect(state.pendingConfirmation).toBeNull();
  });

  // --- Session browser ---

  it('handles SHOW/HIDE_SESSION_BROWSER', () => {
    let state = chatReducer(initialState, {type: 'SHOW_SESSION_BROWSER'});
    expect(state.showSessionBrowser).toBe(true);
    state = chatReducer(state, {type: 'HIDE_SESSION_BROWSER'});
    expect(state.showSessionBrowser).toBe(false);
  });
});
