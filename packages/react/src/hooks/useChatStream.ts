/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Canonical chat-stream hook.
 *
 * Owns the reducer, the SSE event-processing loop, activeToolCalls tracking,
 * and the widget event bus. Transport is injected via `streamFn` — callers
 * are responsible for their own endpoint, auth, session id, etc.
 *
 * The higher-level hooks `useChat` and `useAmodalChat` wrap this one: they
 * add session resume, history loading, ask-user POST helpers, and provider-
 * specific transport. `ConfigChatPage` uses this hook directly.
 *
 * Design goals:
 *   - single canonical reducer (no more drift between useChat/useAmodalChat)
 *   - single canonical SSE → action mapping
 *   - every event type is handled (no silently-dropped events)
 *   - transport is injected (works with /chat/stream, /config/chat, or any
 *     future endpoint that emits our SSE shape)
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
  ConfirmationInfo,
  SSEEvent,
} from '../types';
import { WidgetEventBus } from '../events/event-bus';
import type { WidgetEvent, EntityExtractor } from '../events/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const initialState: ChatState = {
  messages: [],
  sessionId: null,
  isStreaming: false,
  error: null,
  activeToolCalls: [],
  isHistorical: false,
  usage: { inputTokens: 0, outputTokens: 0 },
};

let messageCounter = 0;
function createMessageId(): string {
  messageCounter++;
  return `msg-${Date.now()}-${String(messageCounter)}`;
}

// ---------------------------------------------------------------------------
// Canonical reducer (superset of former useChat/useAmodalChat reducers)
// ---------------------------------------------------------------------------

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND_MESSAGE': {
      const userMessage: ChatMessage = {
        type: 'user',
        id: createMessageId(),
        text: action.text,
        images: action.images,
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
                parameters: action.parameters ?? tc.parameters,
                duration_ms: action.duration_ms,
                error: action.error,
              }
            : tc;
        const updatedCalls = last.toolCalls.map(updateCall);
        const blocks = last.contentBlocks.map((block): ContentBlock =>
          block.type === 'tool_calls'
            ? { ...block, calls: block.calls.map(updateCall) }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, toolCalls: updatedCalls, contentBlocks: blocks };
      }
      const activeToolCalls = state.activeToolCalls.filter((tc) => tc.toolId !== action.toolId);
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
    case 'STREAM_ASK_CHOICE': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'ask_choice',
          askId: action.askId,
          question: action.question,
          options: action.options,
          multi: action.multi,
          status: 'pending',
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'ASK_CHOICE_SUBMITTED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'ask_choice' && block.askId === action.askId
            ? { ...block, status: 'submitted' as const, answer: action.values }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_SHOW_PREVIEW': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'show_preview',
          card: action.card,
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_START_OAUTH': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'start_oauth',
          packageName: action.packageName,
          ...(action.displayName ? {displayName: action.displayName} : {}),
          ...(action.description ? {description: action.description} : {}),
          ...(action.skippable ? {skippable: true} : {}),
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_PROPOSAL': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const block: ContentBlock = {
          type: 'proposal',
          proposalId: action.proposalId,
          summary: action.summary,
          skills: action.skills,
          requiredConnections: action.requiredConnections,
          optionalConnections: action.optionalConnections,
          status: 'pending',
        };
        msgs[msgs.length - 1] = {
          ...last,
          contentBlocks: [...last.contentBlocks, block],
        };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_UPDATE_PLAN': {
      // Mutate the existing ProposalBlock in place (matched by
      // proposalId) so the chat doesn't accumulate duplicate
      // proposals as the user iterates. Walk every assistant turn
      // looking for the original card — the proposal may have been
      // emitted multiple turns back during a long Adjust thread.
      const msgs = state.messages.map((msg) => {
        if (msg.type !== 'assistant_text') return msg;
        let touched = false;
        const blocks = msg.contentBlocks.map((block) => {
          if (block.type !== 'proposal' || block.proposalId !== action.proposalId) return block;
          touched = true;
          return {
            ...block,
            ...(action.summary !== undefined ? {summary: action.summary} : {}),
            ...(action.skills !== undefined ? {skills: action.skills} : {}),
            ...(action.requiredConnections !== undefined ? {requiredConnections: action.requiredConnections} : {}),
            ...(action.optionalConnections !== undefined ? {optionalConnections: action.optionalConnections} : {}),
            // Re-open the buttons after an update so the user can
            // re-confirm against the patched card.
            status: 'pending' as const,
          };
        });
        return touched ? {...msg, contentBlocks: blocks} : msg;
      });
      return {...state, messages: msgs};
    }
    case 'PROPOSAL_SUBMITTED': {
      const msgs = state.messages.map((msg) => {
        if (msg.type !== 'assistant_text') return msg;
        let touched = false;
        const blocks = msg.contentBlocks.map((block) => {
          if (block.type !== 'proposal' || block.proposalId !== action.proposalId) return block;
          touched = true;
          return {...block, status: 'submitted' as const, answer: action.answer};
        });
        return touched ? {...msg, contentBlocks: blocks} : msg;
      });
      return {...state, messages: msgs};
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
        const newStatus: ConfirmationInfo['status'] = action.approved ? 'approved' : 'denied';
        const updatedConfirmations = last.confirmations.map((c) =>
          c.correlationId === action.correlationId ? { ...c, status: newStatus } : c,
        );
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'confirmation' && block.confirmation.correlationId === action.correlationId
            ? { ...block, confirmation: { ...block.confirmation, status: newStatus } }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, confirmations: updatedConfirmations, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_TOOL_LOG': {
      // Tool logs are ephemeral progress from tool executors. We store
      // the latest log message per-tool on the active ToolCallInfo so
      // the UI can show it under the spinning badge. When the tool
      // completes (STREAM_TOOL_CALL_RESULT), the message is cleared.
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant_text') {
        const updateLog = (tc: ToolCallInfo): ToolCallInfo =>
          tc.toolName === action.toolName && tc.status === 'running'
            ? { ...tc, logMessage: action.message }
            : tc;
        const updatedCalls = last.toolCalls.map(updateLog);
        const blocks = last.contentBlocks.map((block) =>
          block.type === 'tool_calls'
            ? { ...block, calls: block.calls.map(updateLog) }
            : block,
        );
        msgs[msgs.length - 1] = { ...last, toolCalls: updatedCalls, contentBlocks: blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'STREAM_CREDENTIAL_SAVED':
    case 'STREAM_APPROVED':
      // Emitted by the server but not reflected in message state today.
      return state;
    case 'STREAM_ERROR':
      return { ...state, isStreaming: false, error: action.message, activeToolCalls: [] };
    case 'STREAM_DONE': {
      // Mark any still-running tool calls as stopped + attach per-turn usage.
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
        doneMessages[doneMessages.length - 1] = {
          ...lastMsg,
          toolCalls: stoppedCalls,
          contentBlocks: stoppedBlocks,
          ...(action.usage ? { usage: action.usage } : {}),
        };
      }
      const newUsage = action.usage
        ? {
            inputTokens: state.usage.inputTokens + action.usage.inputTokens,
            outputTokens: state.usage.outputTokens + action.usage.outputTokens,
          }
        : state.usage;
      return {
        ...state,
        messages: doneMessages,
        isStreaming: false,
        activeToolCalls: [],
        usage: newUsage,
      };
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
    default: {
      // Exhaustiveness check — adding a new ChatAction variant will fail
      // the compile here, not silently fall through.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseChatStreamOptions {
  /**
   * Connect to the transport. Called on every `send()` invocation. The
   * returned async iterable must yield `SSEEvent`s and complete (or throw)
   * when the stream ends. `signal` is the hook-managed abort controller —
   * the implementation should pass it to its underlying fetch/client call.
   */
  streamFn: (text: string, signal: AbortSignal, images?: Array<{mimeType: string; data: string}>) => AsyncIterable<SSEEvent>;

  onToolCall?: (call: ToolCallInfo) => void;
  onKBProposal?: (proposal: KBProposalInfo) => void;
  onEvent?: (event: WidgetEvent) => void;
  onStreamEnd?: () => void;
  onSessionCreated?: (sessionId: string) => void;
  onConfirmation?: (confirmation: ConfirmationInfo) => void;

  /** Extractors registered on the internal event bus. */
  entityExtractors?: EntityExtractor[];
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  activeToolCalls: ToolCallInfo[];
  sessionId: string | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number };
  /** True when a loaded historical session is being viewed (read-only). */
  isHistorical: boolean;

  send: (text: string, images?: Array<{mimeType: string; data: string; preview: string}>) => void;
  stop: () => void;
  reset: () => void;
  respondToConfirmation: (correlationId: string, approved: boolean) => void;

  /**
   * Escape hatch for transport-specific actions (e.g. `LOAD_HISTORY` after
   * fetching a session, `ASK_USER_SUBMITTED` after POSTing an answer).
   */
  dispatch: (action: ChatAction) => void;

  /** Widget-event bus. External consumers subscribe to receive events. */
  eventBus: WidgetEventBus;
}

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn {
  const { entityExtractors } = options;
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const abortControllerRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Event bus — one per hook instance, configured with the caller's extractors.
  const eventBusRef = useRef<WidgetEventBus | null>(null);
  if (!eventBusRef.current) {
    eventBusRef.current = new WidgetEventBus();
    if (entityExtractors) {
      eventBusRef.current.setExtractors(entityExtractors);
    }
  }
  const eventBus = eventBusRef.current;

  // Forward entity_referenced events to the onEvent callback.
  const entityRefHandlerRef = useRef<((e: WidgetEvent) => void) | null>(null);
  if (!entityRefHandlerRef.current) {
    entityRefHandlerRef.current = (e: WidgetEvent) => {
      callbacksRef.current.onEvent?.(e);
    };
    eventBus.on('entity_referenced', entityRefHandlerRef.current);
  }

  // tool_call_start carries the name + params, tool_call_result usually
  // doesn't echo them — keep a map so result events can re-associate.
  const pendingToolCallsRef = useRef<
    Map<string, { toolName: string; parameters: Record<string, unknown> }>
  >(new Map());

  const send = useCallback(
    (text: string, images?: Array<{mimeType: string; data: string; preview: string}>): void => {
      if (state.isStreaming) return;

      dispatch({ type: 'SEND_MESSAGE', text, images: images?.map((i) => i.preview) });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const runStream = async (): Promise<void> => {
        let receivedDone = false;
        try {
          const stream = callbacksRef.current.streamFn(text, controller.signal, images);
          for await (const event of stream) {
            processEvent(event, dispatch, pendingToolCallsRef.current, callbacksRef.current, eventBus);
            if (event.type === 'done') receivedDone = true;
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
          // Safety net: if the stream ended without a `done` event
          // (network drop, mid-stream error), still fire onStreamEnd and
          // flip isStreaming off so the UI doesn't get stuck.
          if (!receivedDone && !controller.signal.aborted) {
            dispatch({ type: 'STREAM_DONE' });
            callbacksRef.current.onStreamEnd?.();
          }
        }
      };

      void runStream();
    },
    // streamFn is read via callbacksRef on each call, so it doesn't need
    // to be a dep here. Keeping send() identity stable across streamFn
    // changes prevents downstream consumers from re-running effects.
    [state.isStreaming, eventBus],
  );

  const stop = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: 'STREAM_DONE' });
  }, []);

  const reset = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    pendingToolCallsRef.current.clear();
    dispatch({ type: 'RESET' });
  }, []);

  const respondToConfirmation = useCallback(
    (correlationId: string, approved: boolean): void => {
      dispatch({ type: 'CONFIRMATION_RESPONDED', correlationId, approved });
      // Matches the legacy useAmodalChat behavior: send the decision as a
      // follow-up user turn so the agent can react.
      if (!state.isStreaming) {
        const text = approved
          ? `I approve the action (correlation: ${correlationId})`
          : `I deny the action (correlation: ${correlationId})`;
        send(text);
      }
    },
    [send, state.isStreaming],
  );

  // Abort on unmount.
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
    isStreaming: state.isStreaming,
    activeToolCalls: state.activeToolCalls,
    sessionId: state.sessionId,
    error: state.error,
    usage: state.usage,
    isHistorical: state.isHistorical,
    send,
    stop,
    reset,
    respondToConfirmation,
    dispatch,
    eventBus,
  };
}

// ---------------------------------------------------------------------------
// Event-to-action translation (the single canonical SSE mapping)
// ---------------------------------------------------------------------------

type Dispatch = (action: ChatAction) => void;
type PendingToolCalls = Map<string, { toolName: string; parameters: Record<string, unknown> }>;

/**
 * Translate a single SSE event into reducer actions + callback invocations.
 * Pure with respect to `state` — any side effects go through `dispatch` or
 * the passed callbacks. Split out of the loop for testability.
 */
function processEvent(
  event: SSEEvent,
  dispatch: Dispatch,
  pending: PendingToolCalls,
  callbacks: UseChatStreamOptions,
  eventBus: WidgetEventBus,
): void {
  switch (event.type) {
    case 'init':
      dispatch({ type: 'STREAM_INIT', sessionId: event.session_id });
      callbacks.onSessionCreated?.(event.session_id);
      return;
    case 'text_delta':
      dispatch({ type: 'STREAM_TEXT_DELTA', content: event.content });
      return;
    case 'tool_call_start':
      dispatch({
        type: 'STREAM_TOOL_CALL_START',
        toolId: event.tool_id,
        toolName: event.tool_name,
        parameters: event.parameters,
      });
      pending.set(event.tool_id, {
        toolName: event.tool_name,
        parameters: event.parameters,
      });
      return;
    case 'tool_call_result': {
      const pendingCall = pending.get(event.tool_id);
      const toolCallResult: ToolCallInfo = {
        toolId: event.tool_id,
        toolName: pendingCall?.toolName ?? '',
        parameters: pendingCall?.parameters ?? {},
        status: event.status,
        result: event.content ?? event.result,
        duration_ms: event.duration_ms,
        error: event.error,
      };
      pending.delete(event.tool_id);
      dispatch({
        type: 'STREAM_TOOL_CALL_RESULT',
        toolId: event.tool_id,
        status: event.status,
        result: event.content ?? event.result,
        duration_ms: event.duration_ms,
        error: event.error,
      });
      callbacks.onToolCall?.(toolCallResult);
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
      callbacks.onEvent?.(toolEvent);
      return;
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
      return;
    case 'skill_activated': {
      dispatch({ type: 'STREAM_SKILL_ACTIVATED', skill: event.skill });
      const skillEvent: WidgetEvent = {
        type: 'skill_activated',
        skill: event.skill,
        timestamp: event.timestamp,
      };
      eventBus.processEvent(skillEvent);
      callbacks.onEvent?.(skillEvent);
      return;
    }
    case 'kb_proposal': {
      const proposal: KBProposalInfo = {
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
      callbacks.onKBProposal?.(proposal);
      const kbEvent: WidgetEvent = {
        type: 'kb_proposal',
        proposal,
        timestamp: event.timestamp,
      };
      eventBus.processEvent(kbEvent);
      callbacks.onEvent?.(kbEvent);
      return;
    }
    case 'widget': {
      dispatch({ type: 'STREAM_WIDGET', widgetType: event.widget_type, data: event.data });
      const widgetEvent: WidgetEvent = {
        type: 'widget_rendered',
        widgetType: event.widget_type,
        data: event.data,
        timestamp: event.timestamp,
      };
      eventBus.processEvent(widgetEvent);
      callbacks.onEvent?.(widgetEvent);
      return;
    }
    case 'ask_user':
      dispatch({
        type: 'STREAM_ASK_USER',
        askId: event.ask_id,
        questions: event.questions,
      });
      return;
    case 'ask_choice':
      dispatch({
        type: 'STREAM_ASK_CHOICE',
        askId: event.ask_id,
        question: event.question,
        options: event.options,
        multi: event.multi ?? false,
      });
      return;
    case 'show_preview':
      dispatch({ type: 'STREAM_SHOW_PREVIEW', card: event.card });
      return;
    case 'start_oauth':
      dispatch({
        type: 'STREAM_START_OAUTH',
        packageName: event.package_name,
        ...(event.display_name ? {displayName: event.display_name} : {}),
        ...(event.description ? {description: event.description} : {}),
        ...(event.skippable ? {skippable: true} : {}),
      });
      return;
    case 'proposal':
      dispatch({
        type: 'STREAM_PROPOSAL',
        proposalId: event.proposal_id,
        summary: event.summary,
        skills: event.skills,
        requiredConnections: event.required_connections,
        optionalConnections: event.optional_connections,
      });
      return;
    case 'update_plan':
      dispatch({
        type: 'STREAM_UPDATE_PLAN',
        proposalId: event.proposal_id,
        ...(event.summary !== undefined ? {summary: event.summary} : {}),
        ...(event.skills !== undefined ? {skills: event.skills} : {}),
        ...(event.required_connections !== undefined
          ? {requiredConnections: event.required_connections}
          : {}),
        ...(event.optional_connections !== undefined
          ? {optionalConnections: event.optional_connections}
          : {}),
      });
      return;
    case 'credential_saved':
      dispatch({ type: 'STREAM_CREDENTIAL_SAVED', connectionName: event.connection_name });
      return;
    case 'approved':
      dispatch({
        type: 'STREAM_APPROVED',
        resourceType: event.resource_type,
        previewId: event.preview_id,
      });
      return;
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
      callbacks.onConfirmation?.(confirmation);
      return;
    }
    case 'tool_log':
      dispatch({ type: 'STREAM_TOOL_LOG', toolName: event.tool_name, message: event.message });
      return;
    case 'warning':
      dispatch({ type: 'STREAM_ERROR', message: event.message });
      return;
    case 'error':
      dispatch({ type: 'STREAM_ERROR', message: event.message });
      return;
    case 'done':
      dispatch({
        type: 'STREAM_DONE',
        usage: event.usage
          ? { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens }
          : undefined,
      });
      callbacks.onStreamEnd?.();
      return;
    case 'explore_start':
    case 'explore_end':
    case 'plan_mode':
    case 'field_scrub':
      // Observability-only events — not reflected in message state today.
      return;
    default: {
      // Exhaustiveness check — any new SSE event must be routed here.
      const _exhaustive: never = event;
      void _exhaustive;
      return;
    }
  }
}
