/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useReducer, useCallback, useRef} from 'react';
import http from 'node:http';
import https from 'node:https';
import type {
  ChatState,
  ChatAction,
  ChatMessage,
  ToolCallInfo,
  NotificationInfo,
  TokenUsageInfo,
} from './types.js';

let nextMessageId = 0;
function genId(): string {
  return `msg-${++nextMessageId}`;
}

let nextNotificationId = 0;
function genNotifId(): string {
  return `notif-${++nextNotificationId}`;
}

const initialTokenUsage: TokenUsageInfo = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  model: null,
  turnCount: 0,
};

export const initialState: ChatState = {
  sessionId: null,
  messages: [],
  streamingText: '',
  activeToolCalls: [],
  activatedSkills: [],
  isStreaming: false,
  error: null,
  thinkingText: '',
  pendingQuestion: null,
  pendingConfirmation: null,
  confirmationQueue: [],
  notifications: [],
  explorePhase: null,
  kbProposals: [],
  tokenUsage: initialTokenUsage,
  showSessionBrowser: false,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {id: genId(), role: 'user', text: action.text},
        ],
        streamingText: '',
        activeToolCalls: [],
        activatedSkills: [],
        isStreaming: true,
        error: null,
        thinkingText: '',
        explorePhase: null,
      };

    case 'INIT':
      return {
        ...state,
        sessionId: action.sessionId,
      };

    case 'TEXT_DELTA':
      return {
        ...state,
        streamingText: state.streamingText + action.content,
      };

    case 'THINKING_DELTA':
      return {
        ...state,
        thinkingText: state.thinkingText + action.content,
      };

    case 'TOOL_CALL_START': {
      const newTool: ToolCallInfo = {
        toolId: action.toolId,
        toolName: action.toolName,
        args: action.args,
        status: 'running',
        subagentEvents: [],
      };
      return {
        ...state,
        activeToolCalls: [...state.activeToolCalls, newTool],
      };
    }

    case 'TOOL_CALL_RESULT': {
      const updated = state.activeToolCalls.map((tc) =>
        tc.toolId === action.toolId
          ? {
              ...tc,
              status: action.status,
              result: action.result,
              error: action.error,
              durationMs: action.durationMs,
            }
          : tc,
      );
      return {
        ...state,
        activeToolCalls: updated,
      };
    }

    case 'SUBAGENT_EVENT': {
      const updated = state.activeToolCalls.map((tc) =>
        tc.toolId === action.parentToolId
          ? {
              ...tc,
              subagentEvents: [
                ...(tc.subagentEvents ?? []),
                {
                  agentName: action.agentName,
                  eventType: action.eventType,
                  toolName: action.toolName,
                  text: action.text,
                  error: action.error,
                },
              ],
            }
          : tc,
      );
      return {
        ...state,
        activeToolCalls: updated,
      };
    }

    case 'SKILL_ACTIVATED':
      return {
        ...state,
        activatedSkills: [...state.activatedSkills, action.skillName],
      };

    case 'ERROR':
      return {
        ...state,
        error: action.message,
        isStreaming: false,
      };

    case 'DONE': {
      // Idempotent: if not streaming, ignore duplicate DONE
      if (!state.isStreaming) {
        return state;
      }
      const assistantMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        text: state.streamingText,
        toolCalls:
          state.activeToolCalls.length > 0
            ? [...state.activeToolCalls]
            : undefined,
        skills:
          state.activatedSkills.length > 0
            ? [...state.activatedSkills]
            : undefined,
        thinking: state.thinkingText || undefined,
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        streamingText: '',
        activeToolCalls: [],
        activatedSkills: [],
        isStreaming: false,
        thinkingText: '',
        explorePhase: null,
      };
    }

    case 'ASK_USER':
      return {
        ...state,
        pendingQuestion: {
          askId: action.askId,
          text: action.questions.map((q) => q.text).join('\n'),
        },
      };

    case 'ASK_USER_RESPOND':
      return {
        ...state,
        pendingQuestion: null,
      };

    case 'CONFIRMATION_REQUIRED':
      return {
        ...state,
        pendingConfirmation: state.pendingConfirmation ?? action.request,
        confirmationQueue: [...state.confirmationQueue, action.request],
      };

    case 'CONFIRMATION_RESPOND': {
      const remaining = state.confirmationQueue.slice(1);
      return {
        ...state,
        pendingConfirmation: remaining[0] ?? null,
        confirmationQueue: remaining,
      };
    }

    case 'KB_PROPOSAL': {
      const notif: NotificationInfo = {
        id: genNotifId(),
        type: 'kb_proposal',
        message: `KB proposal: "${action.proposal.title}" \u2014 ${action.proposal.status}`,
        timestamp: Date.now(),
      };
      return {
        ...state,
        kbProposals: [...state.kbProposals, action.proposal],
        notifications: [...state.notifications, notif],
      };
    }

    case 'NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications, action.notification],
      };

    case 'DISMISS_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.id),
      };

    case 'EXPLORE_START':
      return {
        ...state,
        explorePhase: {query: action.query, active: true},
      };

    case 'EXPLORE_END':
      return {
        ...state,
        explorePhase: state.explorePhase
          ? {
              ...state.explorePhase,
              active: false,
              summary: action.summary,
              tokensUsed: action.tokensUsed,
            }
          : null,
      };

    case 'TOKEN_USAGE': {
      const newInput = state.tokenUsage.totalInputTokens + action.inputTokens;
      const newOutput = state.tokenUsage.totalOutputTokens + action.outputTokens;
      return {
        ...state,
        tokenUsage: {
          totalInputTokens: newInput,
          totalOutputTokens: newOutput,
          totalTokens: newInput + newOutput,
          model: action.model ?? state.tokenUsage.model,
          turnCount: state.tokenUsage.turnCount + 1,
        },
      };
    }

    case 'RESUME_SESSION':
      return {
        ...state,
        sessionId: action.sessionId,
        messages: action.messages,
        isStreaming: false,
      };

    case 'CLEAR_HISTORY':
      return {
        ...initialState,
        sessionId: state.sessionId,
        tokenUsage: state.tokenUsage,
      };

    case 'LOCAL_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {id: genId(), role: 'assistant', text: action.text},
        ],
      };

    case 'SHOW_SESSION_BROWSER':
      return {
        ...state,
        showSessionBrowser: true,
      };

    case 'HIDE_SESSION_BROWSER':
      return {
        ...state,
        showSessionBrowser: false,
      };

    default:
      return state;
  }
}

/**
 * Stream a chat message to the agent server via SSE.
 */
function streamToServer(
  baseUrl: string,
  payload: Record<string, string>,
  dispatch: (action: ChatAction) => void,
): void {
  const body = JSON.stringify(payload);
  const url = new URL('/chat', baseUrl);
  const mod = url.protocol === 'https:' ? https : http;
  const req = mod.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
    },
    (res) => {
      let buffer = '';
      let doneDispatched = false;
      res.setEncoding('utf8');

      const dispatchOnce = (action: ChatAction): void => {
        if (action.type === 'DONE') {
          if (doneDispatched) return;
          doneDispatched = true;
        }
        dispatch(action);
      };

      res.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            handleSSEEvent(event, dispatchOnce);
          } catch {
            // Skip invalid JSON
          }
        }
      });

      res.on('end', () => {
        // Process any remaining data in the buffer
        if (buffer.trim()) {
          const line = buffer.trim();
          buffer = '';
          if (line.startsWith('data: ')) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
              handleSSEEvent(event, dispatchOnce);
            } catch {
              // Skip invalid JSON
            }
          }
        }
        // Safety net: finalize if server didn't send a done event
        dispatchOnce({type: 'DONE'});
      });
    },
  );

  req.on('error', (err) => {
    dispatch({
      type: 'ERROR',
      message: err.message,
    });
  });

  req.write(body);
  req.end();
}

function handleSSEEvent(
  event: Record<string, unknown>,
  dispatch: (action: ChatAction) => void,
): void {
  switch (event['type']) {
    case 'init':
      dispatch({
        type: 'INIT',
        sessionId: String(event['session_id']),
      });
      break;
    case 'text_delta':
      dispatch({
        type: 'TEXT_DELTA',
        content: String(event['content'] ?? ''),
      });
      break;
    case 'thinking_delta':
      dispatch({
        type: 'THINKING_DELTA',
        content: String(event['content'] ?? ''),
      });
      break;
    case 'tool_call_start':
      dispatch({
        type: 'TOOL_CALL_START',
        toolId: String(event['tool_id'] ?? event['tool_name']),
        toolName: String(event['tool_name']),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        args: (event['parameters'] as Record<string, unknown>) ?? {},
      });
      break;
    case 'tool_call_result':
      dispatch({
        type: 'TOOL_CALL_RESULT',
        toolId: String(event['tool_id'] ?? event['tool_name']),
        status:
          event['status'] === 'error' ? 'error' : 'success',
        result: event['result']
          ? String(event['result'])
          : undefined,
        error: event['error']
          ? String(event['error'])
          : undefined,
        durationMs:
          typeof event['duration_ms'] === 'number'
            ? event['duration_ms']
            : undefined,
      });
      break;
    case 'subagent_event':
      dispatch({
        type: 'SUBAGENT_EVENT',
        parentToolId: String(
          event['parent_tool_id'] ?? event['tool_id'] ?? '',
        ),
        agentName: String(event['agent_name'] ?? ''),
        eventType: String(event['event_type'] ?? ''),
        toolName: event['tool_name']
          ? String(event['tool_name'])
          : undefined,
        text: event['text'] ? String(event['text']) : undefined,
        error: event['error']
          ? String(event['error'])
          : undefined,
      });
      break;
    case 'skill_activated':
      dispatch({
        type: 'SKILL_ACTIVATED',
        skillName: String(event['skill_name']),
      });
      break;
    case 'ask_user':
      dispatch({
        type: 'ASK_USER',
        askId: String(event['ask_id'] ?? genId()),
        questions: Array.isArray(event['questions'])
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          ? (event['questions'] as Array<{text: string}>)
          : [{text: String(event['text'] ?? event['message'] ?? '')}],
      });
      break;
    case 'kb_proposal': {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const proposal = event as unknown as {
        proposal_id?: string;
        scope?: string;
        title?: string;
        reasoning?: string;
        status?: string;
      };
      dispatch({
        type: 'KB_PROPOSAL',
        proposal: {
          proposalId: String(proposal.proposal_id ?? genId()),
          scope: String(proposal.scope ?? ''),
          title: String(proposal.title ?? ''),
          reasoning: String(proposal.reasoning ?? ''),
          status: String(proposal.status ?? 'pending'),
        },
      });
      break;
    }
    case 'credential_saved':
      dispatch({
        type: 'NOTIFICATION',
        notification: {
          id: genId(),
          type: 'credential_saved',
          message: `Credential saved for ${String(event['connection'] ?? event['name'] ?? 'unknown')}`,
          timestamp: Date.now(),
        },
      });
      break;
    case 'approved':
      dispatch({
        type: 'NOTIFICATION',
        notification: {
          id: genId(),
          type: 'approved',
          message: String(event['message'] ?? 'Action approved'),
          timestamp: Date.now(),
        },
      });
      break;
    case 'explore_start':
      dispatch({
        type: 'EXPLORE_START',
        query: String(event['query'] ?? ''),
      });
      break;
    case 'explore_end':
      dispatch({
        type: 'EXPLORE_END',
        summary: String(event['summary'] ?? ''),
        tokensUsed: typeof event['tokens_used'] === 'number' ? event['tokens_used'] : 0,
      });
      break;
    case 'confirmation_required':
      dispatch({
        type: 'CONFIRMATION_REQUIRED',
        request: {
          endpoint: String(event['endpoint'] ?? ''),
          method: String(event['method'] ?? ''),
          reason: String(event['reason'] ?? ''),
          escalated: event['escalated'] === true,
        },
      });
      break;
    case 'token_usage':
      dispatch({
        type: 'TOKEN_USAGE',
        inputTokens: typeof event['input_tokens'] === 'number' ? event['input_tokens'] : 0,
        outputTokens: typeof event['output_tokens'] === 'number' ? event['output_tokens'] : 0,
        model: typeof event['model'] === 'string' ? event['model'] : undefined,
      });
      break;
    case 'field_scrub':
      dispatch({
        type: 'NOTIFICATION',
        notification: {
          id: genId(),
          type: 'field_scrub',
          message: String(event['message'] ?? 'Sensitive fields scrubbed from output'),
          timestamp: Date.now(),
        },
      });
      break;
    case 'widget':
      // Widgets are rendered as tool call results; no-op in CLI
      break;
    case 'plan_mode':
      // Plan mode signaling; no-op currently
      break;
    case 'error':
      dispatch({
        type: 'ERROR',
        message: String(event['message']),
      });
      break;
    case 'done':
      dispatch({type: 'DONE'});
      break;
    default:
      break;
  }
}

export interface UseChatResult {
  state: ChatState;
  sendMessage: (text: string) => void;
  respondToQuestion: (askId: string, answer: string) => void;
  respondToConfirmation: (approved: boolean) => void;
  dismissNotification: (id: string) => void;
  dispatch: (action: ChatAction) => void;
}

export function useChat(baseUrl: string, tenantId: string): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const sessionIdRef = useRef<string | null>(null);

  // Track sessionId in ref so sendMessage closure always has latest
  if (state.sessionId !== null) {
    sessionIdRef.current = state.sessionId;
  }

  const sendMessage = useCallback(
    (text: string) => {
      dispatch({type: 'SEND_MESSAGE', text});
      const payload: Record<string, string> = {
        message: text,
        tenant_id: tenantId,
      };
      if (sessionIdRef.current) {
        payload['session_id'] = sessionIdRef.current;
      }
      streamToServer(baseUrl, payload, dispatch);
    },
    [baseUrl, tenantId],
  );

  const respondToQuestion = useCallback(
    (askId: string, answer: string) => {
      dispatch({type: 'ASK_USER_RESPOND', askId, answer});
      const payload: Record<string, string> = {
        ask_id: askId,
        answer,
        tenant_id: tenantId,
      };
      if (sessionIdRef.current) {
        payload['session_id'] = sessionIdRef.current;
      }
      // POST the answer back to the server
      const body = JSON.stringify(payload);
      const respondUrl = new URL('/chat/respond', baseUrl);
      const respondMod = respondUrl.protocol === 'https:' ? https : http;
      const req = respondMod.request(respondUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
      });
      req.on('error', () => {
        // Silently ignore response errors
      });
      req.write(body);
      req.end();
    },
    [baseUrl, tenantId],
  );

  const respondToConfirmation = useCallback(
    (approved: boolean) => {
      dispatch({type: 'CONFIRMATION_RESPOND', approved});
      const payload: Record<string, string> = {
        approved: String(approved),
        tenant_id: tenantId,
      };
      if (sessionIdRef.current) {
        payload['session_id'] = sessionIdRef.current;
      }
      const body = JSON.stringify(payload);
      const confirmUrl = new URL('/chat/confirm', baseUrl);
      const confirmMod = confirmUrl.protocol === 'https:' ? https : http;
      const req = confirmMod.request(confirmUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
      });
      req.on('error', () => {
        // Silently ignore response errors
      });
      req.write(body);
      req.end();
    },
    [baseUrl, tenantId],
  );

  const dismissNotification = useCallback((id: string) => {
    dispatch({type: 'DISMISS_NOTIFICATION', id});
  }, []);

  return {state, sendMessage, respondToQuestion, respondToConfirmation, dismissNotification, dispatch};
}
