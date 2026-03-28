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
  KBProposalInfo,
  WidgetInfo,
  ContentBlock,
  ChatUser,
} from '../types';
import { streamChat, getSessionHistory } from '../client/chat-api';
import { WidgetEventBus } from '../events/event-bus';
import type { WidgetEvent, EntityExtractor } from '../events/types';

const initialState: ChatState = {
  messages: [],
  sessionId: null,
  isStreaming: false,
  error: null,
  activeToolCalls: [],
  isHistorical: false,
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
        isHistorical: false,
      };
    }
    case 'STREAM_INIT':
      return { ...state, sessionId: action.sessionId };
    case 'STREAM_TEXT_DELTA': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        // Append to content blocks: merge into last text block or create new one
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
        // Add to flat toolCalls array (backwards compat)
        const updatedToolCalls = [...last.toolCalls, toolCall];
        // Add to contentBlocks: append to existing tool_calls block or create new one
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
        // Also update inside contentBlocks
        const blocks = last.contentBlocks.map((block): ContentBlock =>
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
    case 'STREAM_SKILL_ACTIVATED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        msgs[msgs.length - 1] = {
          ...last,
          skillActivations: [...last.skillActivations, action.skill],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_KB_PROPOSAL': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      const proposal: KBProposalInfo = {
        scope: action.scope,
        title: action.title,
        reasoning: action.reasoning,
      };
      if (last && last.type === 'assistant_text') {
        msgs[msgs.length - 1] = {
          ...last,
          kbProposals: [...last.kbProposals, proposal],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_WIDGET': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const widget: WidgetInfo = {
          widgetType: action.widgetType,
          data: action.data,
        };
        const block: ContentBlock = {
          type: 'widget',
          widgetType: action.widgetType,
          data: action.data,
        };
        msgs[msgs.length - 1] = {
          ...last,
          widgets: [...last.widgets, widget],
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_ASK_USER': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'ask_user',
          askId: action.askId,
          questions: action.questions,
          status: 'pending',
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'ASK_USER_SUBMITTED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'ask_user' && block.askId === action.askId
            ? { ...block, status: 'submitted' as const, answers: action.answers }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, contentBlocks: blocks };
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
            ? { ...c, status: (action.approved ? 'approved' : 'denied') as import('../types').ConfirmationInfo['status'] }
            : c,
        );
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'confirmation' && block.confirmation.correlationId === action.correlationId
            ? { ...block, confirmation: { ...block.confirmation, status: (action.approved ? 'approved' : 'denied') as import('../types').ConfirmationInfo['status'] } }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, confirmations: updatedConfirmations, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_CREDENTIAL_SAVED':
    case 'STREAM_APPROVED':
      // These events are tracked but don't modify message state currently
      return state;
    case 'STREAM_ERROR':
      return { ...state, isStreaming: false, error: action.message, activeToolCalls: [] };
    case 'STREAM_DONE': {
      // Mark any still-running tool calls as stopped
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
      return { ...state, messages: doneMessages, isStreaming: false, activeToolCalls: [] };
    }
    case 'LOAD_HISTORY':
      return {
        ...initialState,
        messages: action.messages,
        sessionId: action.sessionId,
        isHistorical: true,
      };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

export interface UseChatOptions {
  serverUrl: string;
  user: ChatUser;
  /** Return a Bearer token (API key or JWT) for authenticated requests. */
  getToken?: () => string | null | undefined;
  onToolCall?: (call: ToolCallInfo) => void;
  onKBProposal?: (proposal: KBProposalInfo) => void;
  /** Callback for all widget events (agent-driven + interaction). */
  onEvent?: (event: WidgetEvent) => void;
  /** Custom entity extractors. If provided, replaces the default extractor. */
  entityExtractors?: EntityExtractor[];
  /** Session type — controls which skills, tools, KB docs load into this session. */
  sessionType?: string;
  /** Specific deployment ID to load instead of the active deployment. */
  deployId?: string;
  /** Auto-send this message when the hook mounts. Sent exactly once via ref guard. */
  initialMessage?: string;
  /** Load an existing session on mount (read-only history view). Takes precedence over initialMessage. */
  resumeSessionId?: string;
  /** Called when the SSE stream ends (agent finishes responding). */
  onStreamEnd?: () => void;
  /** Called when a session ID is received from the server (first stream init). */
  onSessionCreated?: (sessionId: string) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  send: (text: string) => void;
  /** Stop the current stream without clearing history. */
  stop: () => void;
  isStreaming: boolean;
  activeToolCalls: ToolCallInfo[];
  session: { id: string | null; role?: string };
  error: string | null;
  reset: () => void;
  /** Event bus for subscribing to widget events. */
  eventBus: WidgetEventBus;
  /** Submit answers to a pending ask_user prompt. */
  submitAskUserResponse: (askId: string, answers: Record<string, string>) => void;
  /** Load a historical session for read-only viewing. */
  loadSession: (sessionId: string) => void;
  /** True when viewing a loaded historical session. */
  isHistorical: boolean;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { serverUrl, user, getToken, onToolCall, onKBProposal, onEvent, entityExtractors, sessionType, deployId, initialMessage, resumeSessionId, onStreamEnd, onSessionCreated } = options;
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const sessionIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef({ onToolCall, onKBProposal, getToken, onEvent, onStreamEnd, onSessionCreated });
  callbacksRef.current = { onToolCall, onKBProposal, getToken, onEvent, onStreamEnd, onSessionCreated };

  // Create event bus once, configure extractors
  const eventBusRef = useRef<WidgetEventBus | null>(null);
  if (!eventBusRef.current) {
    eventBusRef.current = new WidgetEventBus();
    if (entityExtractors) {
      eventBusRef.current.setExtractors(entityExtractors);
    }
  }
  const eventBus = eventBusRef.current;

  // Forward entity_referenced events to onEvent callback
  const entityRefHandlerRef = useRef<((e: WidgetEvent) => void) | null>(null);
  if (!entityRefHandlerRef.current) {
    entityRefHandlerRef.current = (e: WidgetEvent) => {
      callbacksRef.current.onEvent?.(e);
    };
    eventBus.on('entity_referenced', entityRefHandlerRef.current);
  }

  // Track pending tool calls for name/param lookup on result
  const pendingToolCallsRef = useRef<Map<string, { toolName: string; parameters: Record<string, unknown> }>>(new Map());

  // Keep ref in sync
  sessionIdRef.current = state.sessionId;

  const send = useCallback(
    (text: string) => {
      if (state.isStreaming) return;

      dispatch({ type: 'SEND_MESSAGE', text });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const runStream = async () => {
        let receivedDone = false;
        try {
          const token = callbacksRef.current.getToken?.() ?? undefined;
          const stream = streamChat(
            serverUrl,
            {
              message: text,
              session_id: sessionIdRef.current ?? undefined,
              role: user.role,
              session_type: sessionType,
              deploy_id: deployId,
            },
            controller.signal,
            token,
          );

          for await (const event of stream) {
            switch (event.type) {
              case 'init':
                dispatch({ type: 'STREAM_INIT', sessionId: event.session_id });
                callbacksRef.current.onSessionCreated?.(event.session_id);
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
                pendingToolCallsRef.current.set(event.tool_id, {
                  toolName: event.tool_name,
                  parameters: event.parameters,
                });
                break;
              case 'tool_call_result': {
                const pending = pendingToolCallsRef.current.get(event.tool_id);
                const toolCallResult: ToolCallInfo = {
                  toolId: event.tool_id,
                  toolName: pending?.toolName ?? '',
                  parameters: pending?.parameters ?? {},
                  status: event.status,
                  result: event.result,
                  duration_ms: event.duration_ms,
                  error: event.error,
                };
                pendingToolCallsRef.current.delete(event.tool_id);
                dispatch({
                  type: 'STREAM_TOOL_CALL_RESULT',
                  toolId: event.tool_id,
                  status: event.status,
                  result: event.result,
                  duration_ms: event.duration_ms,
                  error: event.error,
                });
                callbacksRef.current.onToolCall?.(toolCallResult);

                // Emit tool_executed event
                const toolEvent: WidgetEvent = {
                  type: 'tool_executed',
                  toolName: toolCallResult.toolName,
                  toolId: toolCallResult.toolId,
                  parameters: toolCallResult.parameters,
                  status: event.status,
                  result: event.result,
                  duration_ms: event.duration_ms,
                  error: event.error,
                  timestamp: event.timestamp,
                };
                eventBus.processEvent(toolEvent);
                callbacksRef.current.onEvent?.(toolEvent);
                break;
              }
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
              case 'skill_activated': {
                dispatch({ type: 'STREAM_SKILL_ACTIVATED', skill: event.skill });
                const skillEvent: WidgetEvent = {
                  type: 'skill_activated',
                  skill: event.skill,
                  timestamp: event.timestamp,
                };
                eventBus.processEvent(skillEvent);
                callbacksRef.current.onEvent?.(skillEvent);
                break;
              }
              case 'kb_proposal': {
                const proposal = {
                  scope: event.scope,
                  title: event.title,
                  reasoning: event.reasoning,
                };
                dispatch({
                  type: 'STREAM_KB_PROPOSAL',
                  scope: event.scope,
                  title: event.title,
                  reasoning: event.reasoning,
                });
                callbacksRef.current.onKBProposal?.(proposal);

                const kbEvent: WidgetEvent = {
                  type: 'kb_proposal',
                  proposal,
                  timestamp: event.timestamp,
                };
                eventBus.processEvent(kbEvent);
                callbacksRef.current.onEvent?.(kbEvent);
                break;
              }
              case 'widget': {
                dispatch({
                  type: 'STREAM_WIDGET',
                  widgetType: event.widget_type,
                  data: event.data,
                });
                const widgetEvent: WidgetEvent = {
                  type: 'widget_rendered',
                  widgetType: event.widget_type,
                  data: event.data,
                  timestamp: event.timestamp,
                };
                eventBus.processEvent(widgetEvent);
                callbacksRef.current.onEvent?.(widgetEvent);
                break;
              }
              case 'ask_user':
                dispatch({
                  type: 'STREAM_ASK_USER',
                  askId: event.ask_id,
                  questions: event.questions,
                });
                break;
              case 'credential_saved':
                dispatch({ type: 'STREAM_CREDENTIAL_SAVED', connectionName: event.connection_name });
                break;
              case 'approved':
                dispatch({ type: 'STREAM_APPROVED', resourceType: event.resource_type, previewId: event.preview_id });
                break;
              case 'error':
                dispatch({ type: 'STREAM_ERROR', message: event.message });
                break;
              case 'done':
                receivedDone = true;
                dispatch({ type: 'STREAM_DONE' });
                callbacksRef.current.onStreamEnd?.();
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
          // Safety net: if the stream ended without a 'done' event
          // (e.g., error path, network drop), still fire onStreamEnd
          if (!receivedDone && !controller.signal.aborted) {
            dispatch({ type: 'STREAM_DONE' });
            callbacksRef.current.onStreamEnd?.();
          }
        }
      };

      void runStream();
    },
    [serverUrl, user.role, state.isStreaming, eventBus, sessionType, deployId],
  );

  // Resume an existing session on mount (takes precedence over initialMessage).
  const resumeLoadedRef = useRef(false);
  useEffect(() => {
    if (!resumeSessionId || resumeLoadedRef.current) return;
    resumeLoadedRef.current = true;
    // Mark initial message as delivered so it never fires after session load
    initialMessageDeliveredRef.current = true;
    loadSession(resumeSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSessionId]);

  // Auto-send initialMessage once on mount. Uses two refs:
  // - `sent`: flips true once send() is called — prevents re-sends on re-renders
  //   caused by dependency changes (e.g. `send` changing when isStreaming toggles).
  // - `delivered`: flips true when the stream completes without abort — prevents
  //   re-sends after successful delivery. Stays false if the stream was aborted
  //   (React StrictMode unmount), allowing retry on remount.
  const initialMessageSentRef = useRef(false);
  const initialMessageDeliveredRef = useRef(false);
  useEffect(() => {
    // Skip if resuming an existing session (prop-based or history-loaded)
    if (resumeSessionId) return;
    if (state.isHistorical) return;
    if (!initialMessage || initialMessageDeliveredRef.current) return;
    // Reset the sent guard — this effect re-runs on StrictMode remount
    // after the previous stream was aborted by cleanup.
    initialMessageSentRef.current = false;

    // Use a microtask to let React finish its synchronous StrictMode
    // unmount/remount cycle before starting the fetch.
    const timer = setTimeout(() => {
      if (!initialMessageSentRef.current && !initialMessageDeliveredRef.current) {
        initialMessageSentRef.current = true;
        send(initialMessage);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  // Only depend on initialMessage — send is stable enough via ref pattern,
  // and we don't want dependency changes to re-trigger the initial send.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, state.isHistorical]);

  // Track successful delivery so re-renders never re-send.
  useEffect(() => {
    if (initialMessage && initialMessageSentRef.current && !state.isStreaming && state.messages.length > 0) {
      initialMessageDeliveredRef.current = true;
    }
  }, [initialMessage, state.isStreaming, state.messages.length]);

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

  const submitAskUserResponse = useCallback(
    (askId: string, answers: Record<string, string>) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      dispatch({ type: 'ASK_USER_SUBMITTED', askId, answers });

      const doSubmit = async () => {
        try {
          const token = callbacksRef.current.getToken?.() ?? undefined;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          await fetch(
            `${serverUrl}/chat/sessions/${sid}/ask-user-response`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ ask_id: askId, answers }),
            },
          );
        } catch {
          // Non-critical: if this fails the server will time out the ask_user
        }
      };

      void doSubmit();
    },
    [serverUrl],
  );

  const loadSession = useCallback(
    (sessionId: string) => {
      // Suppress initial message when loading a previous session
      initialMessageDeliveredRef.current = true;
      const doLoad = async () => {
        try {
          const token = callbacksRef.current.getToken?.() ?? undefined;
          const detail = await getSessionHistory(serverUrl, sessionId, token);
          // Convert stored messages to ChatMessage format
          const chatMessages: ChatMessage[] = detail.messages.map((m) => {
            if (m.type === 'assistant_text') {
              // Map stored tool calls to ToolCallInfo (args -> parameters)
              const toolCalls: ToolCallInfo[] = (m.toolCalls ?? []).map((tc) => ({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                toolId: tc['toolId'] as string ?? '',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                toolName: tc['toolName'] as string ?? '',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored args from DB
                parameters: (tc['args'] as Record<string, unknown>) ?? {},
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                status: (tc['status'] as ToolCallInfo['status']) ?? 'success',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                duration_ms: tc['duration_ms'] as number | undefined,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                error: tc['error'] as string | undefined,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored tool call from DB
                result: tc['result'] as string | undefined,
              }));

              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored widgets from DB
              const widgets = (m.widgets ?? []) as unknown as Array<import('../types').WidgetInfo>;

              // Rebuild content blocks from stored data.
              // If the server saved ordered contentBlocks, use them to preserve
              // the original interleave of text / tool_calls / widgets.
              const storedBlocks = m.contentBlocks;
              const contentBlocks: Array<import('../types').ContentBlock> = [];
              if (storedBlocks && storedBlocks.length > 0) {
                // Build a lookup from toolId -> ToolCallInfo
                const toolCallById = new Map(toolCalls.map((tc) => [tc.toolId, tc]));
                for (const block of storedBlocks) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored block from DB
                  const blockType = block['type'] as string;
                  if (blockType === 'text') {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored block from DB
                    const text = block['text'] as string;
                    if (text.length > 0) {
                      contentBlocks.push({ type: 'text', text });
                    }
                  } else if (blockType === 'tool_calls') {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored block from DB
                    const callIds = block['callIds'] as string[] | undefined;
                    const calls = callIds
                      ? callIds.map((id) => toolCallById.get(id)).filter(
                          (tc): tc is import('../types').ToolCallInfo => tc != null,
                        )
                      : toolCalls;
                    if (calls.length > 0) {
                      contentBlocks.push({ type: 'tool_calls', calls });
                    }
                  } else if (blockType === 'widget') {
                    contentBlocks.push({
                      type: 'widget',
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored block from DB
                      widgetType: block['widgetType'] as string,
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored widget data from DB
                      data: (block['data'] as Record<string, unknown>) ?? {},
                    });
                  }
                }
              } else {
                // Fallback: legacy messages without stored contentBlocks
                if (toolCalls.length > 0) {
                  contentBlocks.push({ type: 'tool_calls', calls: toolCalls });
                }
                if (m.text.length > 0) {
                  contentBlocks.push({ type: 'text', text: m.text });
                }
                for (const w of widgets) {
                  contentBlocks.push({ type: 'widget', widgetType: w.widgetType, data: w.data });
                }
              }

              return {
                type: 'assistant_text' as const,
                id: m.id,
                text: m.text,
                toolCalls,
                confirmations: [],
                skillActivations: m.skillActivations ?? [],
                kbProposals: [],
                widgets,
                contentBlocks,
                timestamp: m.timestamp,
              };
            }
            if (m.type === 'error') {
              return {
                type: 'error' as const,
                id: m.id,
                message: m.text,
                timestamp: m.timestamp,
              };
            }
            return {
              type: 'user' as const,
              id: m.id,
              text: m.text,
              timestamp: m.timestamp,
            };
          });
          dispatch({ type: 'LOAD_HISTORY', sessionId, messages: chatMessages });
        } catch (err) {
          dispatch({
            type: 'STREAM_ERROR',
            message: err instanceof Error ? err.message : 'Failed to load session',
          });
        }
      };
      void doLoad();
    },
    [serverUrl],
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
    session: { id: state.sessionId, role: user.role },
    error: state.error,
    reset,
    eventBus,
    submitAskUserResponse,
    loadSession,
    isHistorical: state.isHistorical,
  };
}
