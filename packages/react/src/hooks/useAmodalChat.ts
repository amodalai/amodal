/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  ChatState,
  ChatAction,
  ChatMessage,
  AssistantTextMessage,
  ToolCallInfo,
  ContentBlock,
  ConfirmationInfo,
} from '../types';
import { useAmodalContext } from '../provider';

const initialState: ChatState = {
  messages: [],
  sessionId: null,
  isStreaming: false,
  error: null,
  activeToolCalls: [],
  isHistorical: false,
  usage: {inputTokens: 0, outputTokens: 0},
};

let messageCounter = 0;

function createMessageId(): string {
  messageCounter++;
  return `msg-${Date.now()}-${String(messageCounter)}`;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND_MESSAGE': {
      const userMessage: ChatMessage = {
        type: 'user',
        id: createMessageId(),
        text: action.text,
        timestamp: new Date().toISOString(),
      };
      const assistantMessage: AssistantTextMessage = {
        type: 'assistant_text',
        id: createMessageId(),
        text: '',
        toolCalls: [],
        confirmations: [],
        skillActivations: [],
        kbProposals: [],
        widgets: [],
        contentBlocks: [],
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        messages: [...state.messages, userMessage, assistantMessage],
        isStreaming: true,
        error: null,
        activeToolCalls: [],
      };
    }
    case 'STREAM_INIT':
      return { ...state, sessionId: action.sessionId };
    case 'STREAM_TEXT_DELTA': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const blocks = [...last.contentBlocks];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + action.content };
        } else {
          blocks.push({ type: 'text', text: action.content });
        }
        msgs[msgs.length - 1] = { ...last, text: last.text + action.content, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_TOOL_CALL_START': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      const toolCall: ToolCallInfo = {
        toolId: action.toolId,
        toolName: action.toolName,
        parameters: action.parameters,
        status: 'running',
      };
      if (last && last.type === 'assistant_text') {
        const updatedToolCalls = [...last.toolCalls, toolCall];
        const blocks = [...last.contentBlocks];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'tool_calls') {
          blocks[blocks.length - 1] = { type: 'tool_calls', calls: [...lastBlock.calls, toolCall] };
        } else {
          blocks.push({ type: 'tool_calls', calls: [toolCall] });
        }
        msgs[msgs.length - 1] = { ...last, toolCalls: updatedToolCalls, contentBlocks: blocks };
      }
      return {
        ...state,
        messages: msgs,
        activeToolCalls: [...state.activeToolCalls, toolCall],
      };
    }
    case 'STREAM_TOOL_CALL_RESULT': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const updateCall = (tc: ToolCallInfo): ToolCallInfo =>
          tc.toolId === action.toolId
            ? {
                ...tc,
                status: action.status,
                result: action.result,
                duration_ms: action.duration_ms,
                error: action.error,
              }
            : tc;
        const updatedCalls = last.toolCalls.map(updateCall);
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'tool_calls'
            ? { ...block, calls: block.calls.map(updateCall) }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, toolCalls: updatedCalls, contentBlocks: blocks };
      }
      const activeToolCalls = state.activeToolCalls.filter(
        (tc) => tc.toolId !== action.toolId,
      );
      return { ...state, messages: msgs, activeToolCalls };
    }
    case 'STREAM_SUBAGENT_EVENT': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const appendEvent = (tc: ToolCallInfo): ToolCallInfo =>
          tc.toolId === action.parentToolId
            ? { ...tc, subagentEvents: [...(tc.subagentEvents ?? []), action.event] }
            : tc;
        const updatedCalls = last.toolCalls.map(appendEvent);
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'tool_calls'
            ? { ...block, calls: block.calls.map(appendEvent) }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, toolCalls: updatedCalls, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_WIDGET': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'widget',
          widgetType: action.widgetType,
          data: action.data,
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_CONFIRMATION_REQUIRED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'confirmation',
          confirmation: action.confirmation,
        };
        msgs[msgs.length - 1] = {
          ...last,
          confirmations: [...last.confirmations, action.confirmation],
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'CONFIRMATION_RESPONDED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const updatedConfirmations = last.confirmations.map((c) =>
          c.correlationId === action.correlationId
            ? { ...c, status: (action.approved ? 'approved' : 'denied') as ConfirmationInfo['status'] }
            : c,
        );
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'confirmation' && block.confirmation.correlationId === action.correlationId
            ? { ...block, confirmation: { ...block.confirmation, status: (action.approved ? 'approved' : 'denied') as ConfirmationInfo['status'] } }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, confirmations: updatedConfirmations, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_ERROR':
      return { ...state, isStreaming: false, error: action.message, activeToolCalls: [] };
    case 'STREAM_DONE': {
      const doneMessages = [...state.messages];
      const lastMsg = doneMessages[doneMessages.length - 1];
      if (lastMsg && lastMsg.type === 'assistant_text') {
        const stopRunning = (tc: ToolCallInfo): ToolCallInfo =>
          tc.status === 'running' ? { ...tc, status: 'error', error: 'Stopped' } : tc;
        const stoppedCalls = lastMsg.toolCalls.map(stopRunning);
        const stoppedBlocks = lastMsg.contentBlocks.map((block) =>
          block.type === 'tool_calls'
            ? { ...block, calls: block.calls.map(stopRunning) }
            : block,
        );
        doneMessages[doneMessages.length - 1] = { ...lastMsg, toolCalls: stoppedCalls, contentBlocks: stoppedBlocks };
      }
      const newUsage = action.usage
        ? {inputTokens: state.usage.inputTokens + action.usage.inputTokens, outputTokens: state.usage.outputTokens + action.usage.outputTokens}
        : state.usage;
      return { ...state, messages: doneMessages, isStreaming: false, activeToolCalls: [], usage: newUsage };
    }
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

export interface UseAmodalChatOptions {
  /** Pre-seed session ID for resuming a previous session. */
  initialSessionId?: string | null;
  /** Additional context sent with each chat message. */
  context?: Record<string, unknown>;
  /** Called when the SSE stream ends. */
  onStreamEnd?: () => void;
  /** Called when a session ID is received from the server. */
  onSessionCreated?: (sessionId: string) => void;
  /** Called on each tool call result. */
  onToolCall?: (call: ToolCallInfo) => void;
  /** Called when a confirmation is required. */
  onConfirmation?: (confirmation: ConfirmationInfo) => void;
}

export interface UseAmodalChatReturn {
  messages: ChatMessage[];
  send: (text: string) => void;
  stop: () => void;
  isStreaming: boolean;
  activeToolCalls: ToolCallInfo[];
  sessionId: string | null;
  error: string | null;
  usage: {inputTokens: number; outputTokens: number};
  reset: () => void;
  respondToConfirmation: (correlationId: string, approved: boolean) => void;
}

export function useAmodalChat(options?: UseAmodalChatOptions): UseAmodalChatReturn {
  const { client } = useAmodalContext();
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const sessionIdRef = useRef<string | null>(options?.initialSessionId ?? null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  sessionIdRef.current = state.sessionId ?? sessionIdRef.current;

  const send = useCallback(
    (text: string) => {
      if (state.isStreaming) return;

      dispatch({ type: 'SEND_MESSAGE', text });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const runStream = async () => {
        let receivedDone = false;
        try {
          const stream = client.chatStream(text, {
            sessionId: sessionIdRef.current ?? undefined,
            context: callbacksRef.current?.context,
            signal: controller.signal,
          });

          for await (const event of stream) {
            switch (event.type) {
              case 'init':
                dispatch({ type: 'STREAM_INIT', sessionId: event.session_id });
                callbacksRef.current?.onSessionCreated?.(event.session_id);
                break;
              case 'text_delta':
                dispatch({ type: 'STREAM_TEXT_DELTA', content: event.content });
                break;
              case 'tool_call_start':
                dispatch({
                  type: 'STREAM_TOOL_CALL_START',
                  toolId: event.tool_id,
                  toolName: event.tool_name,
                  parameters: event.parameters,
                });
                break;
              case 'tool_call_result':
                dispatch({
                  type: 'STREAM_TOOL_CALL_RESULT',
                  toolId: event.tool_id,
                  status: event.status,
                  result: event.result,
                  duration_ms: event.duration_ms,
                  error: event.error,
                });
                callbacksRef.current?.onToolCall?.({
                  toolId: event.tool_id,
                  toolName: '',
                  parameters: {},
                  status: event.status,
                  result: event.result,
                  duration_ms: event.duration_ms,
                  error: event.error,
                });
                break;
              case 'subagent_event':
                dispatch({
                  type: 'STREAM_SUBAGENT_EVENT',
                  parentToolId: event.parent_tool_id,
                  event: {
                    agentName: event.agent_name,
                    eventType: event.event_type,
                    toolName: event.tool_name,
                    toolArgs: event.tool_args,
                    result: event.result,
                    text: event.text,
                    error: event.error,
                    timestamp: event.timestamp,
                  },
                });
                break;
              case 'widget':
                dispatch({
                  type: 'STREAM_WIDGET',
                  widgetType: event.widget_type,
                  data: event.data,
                });
                break;
              case 'confirmation_required': {
                const confirmation: ConfirmationInfo = {
                  endpoint: event.endpoint,
                  method: event.method,
                  reason: event.reason,
                  escalated: event.escalated,
                  params: event.params,
                  connectionName: event.connection_name,
                  correlationId: event.correlation_id,
                  status: 'pending',
                };
                dispatch({ type: 'STREAM_CONFIRMATION_REQUIRED', confirmation });
                callbacksRef.current?.onConfirmation?.(confirmation);
                break;
              }
              case 'error':
                dispatch({ type: 'STREAM_ERROR', message: event.message });
                break;
              case 'done':
                receivedDone = true;
                dispatch({
                  type: 'STREAM_DONE',
                  usage: event.usage ? {inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens} : undefined,
                });
                callbacksRef.current?.onStreamEnd?.();
                break;
              default:
                break;
            }
          }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            dispatch({
              type: 'STREAM_ERROR',
              message: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        } finally {
          abortControllerRef.current = null;
          if (!receivedDone && !controller.signal.aborted) {
            dispatch({ type: 'STREAM_DONE' });
            callbacksRef.current?.onStreamEnd?.();
          }
        }
      };

      void runStream();
    },
    [client, state.isStreaming],
  );

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: 'STREAM_DONE' });
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  const respondToConfirmation = useCallback(
    (correlationId: string, approved: boolean) => {
      dispatch({ type: 'CONFIRMATION_RESPONDED', correlationId, approved });

      // Send approval/denial as a follow-up chat message
      const responseText = approved
        ? `I approve the action (correlation: ${correlationId})`
        : `I deny the action (correlation: ${correlationId})`;

      // Queue the response after the current stream ends
      if (!state.isStreaming) {
        send(responseText);
      }
    },
    [send, state.isStreaming],
  );

  // Abort on unmount
  useEffect(
    () => () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    },
    [],
  );

  return {
    messages: state.messages,
    send,
    stop,
    isStreaming: state.isStreaming,
    activeToolCalls: state.activeToolCalls,
    sessionId: state.sessionId,
    error: state.error,
    usage: state.usage,
    reset,
    respondToConfirmation,
  };
}
