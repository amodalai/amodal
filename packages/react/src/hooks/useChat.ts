/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * High-level chat hook for consumers that use the `/chat/stream` endpoint
 * (Bearer-auth, session resume, history loading, ask-user POST helpers).
 *
 * This hook is a thin wrapper around `useChatStream` — the canonical
 * reducer + SSE event loop lives there. Everything here is transport
 * and session management specific to the main chat flow:
 *   - streamChat() → POST /chat/stream
 *   - GET /chat/sessions/:id/history
 *   - POST /chat/sessions/:id/ask-user-response
 *   - `initialMessage` auto-send + StrictMode safe retry
 *   - `resumeSessionId` mount-time history load
 *
 * The public API (UseChatOptions, UseChatReturn) is unchanged from
 * earlier versions; this file used to carry its own copy of the reducer.
 */
import { useCallback, useEffect, useRef } from 'react';
import type {
  ChatMessage,
  ToolCallInfo,
  KBProposalInfo,
  ContentBlock,
  ChatUser,
  SSEEvent,
} from '../types';
import { streamChat, getSessionHistory } from '../client/chat-api';
import type { WidgetEventBus } from '../events/event-bus';
import type { WidgetEvent, EntityExtractor } from '../events/types';
import { useChatStream } from './useChatStream';

export { chatReducer } from './useChatStream';

// ---------------------------------------------------------------------------
// Public API (unchanged)
// ---------------------------------------------------------------------------

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
  session: { id: string | null };
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(options: UseChatOptions): UseChatReturn {
  const {
    serverUrl,
    getToken,
    onToolCall,
    onKBProposal,
    onEvent,
    entityExtractors,
    sessionType,
    deployId,
    initialMessage,
    resumeSessionId,
    onStreamEnd,
    onSessionCreated,
  } = options;

  // We keep callbacks + request metadata in refs so the streamFn closure
  // captured by useChatStream stays stable while still using fresh values.
  const authRef = useRef({ getToken, sessionType, deployId });
  authRef.current = { getToken, sessionType, deployId };

  // Track current session id in a ref so the streamFn closure can pass it
  // with every POST (used to resume an in-flight session).
  const sessionIdRef = useRef<string | null>(null);

  // Build a transport function that calls streamChat with /chat/stream.
  const streamFn = useCallback(
    (text: string, signal: AbortSignal, images?: Array<{mimeType: string; data: string}>): AsyncIterable<SSEEvent> => {
      const token = authRef.current.getToken?.() ?? undefined;
      return streamChat(
        serverUrl,
        {
          message: text,
          images,
          session_id: sessionIdRef.current ?? undefined,
          session_type: authRef.current.sessionType,
          deploy_id: authRef.current.deployId,
        },
        signal,
        token,
      );
    },
    [serverUrl],
  );

  const stream = useChatStream({
    streamFn,
    ...(onToolCall ? { onToolCall } : {}),
    ...(onKBProposal ? { onKBProposal } : {}),
    ...(onEvent ? { onEvent } : {}),
    ...(onStreamEnd ? { onStreamEnd } : {}),
    ...(onSessionCreated ? { onSessionCreated } : {}),
    ...(entityExtractors ? { entityExtractors } : {}),
  });

  // Mirror sessionId into the ref so streamFn picks up the value on the
  // next send() call — streamFn closure captures the ref, not a snapshot.
  sessionIdRef.current = stream.sessionId;

  // ---------------------------------------------------------------------
  // Session resume + initialMessage auto-send (unchanged behavior)
  // ---------------------------------------------------------------------

  const initialMessageSentRef = useRef(false);
  const initialMessageDeliveredRef = useRef(false);
  const resumeLoadedRef = useRef(false);

  const loadSession = useCallback(
    (sessionId: string) => {
      // Suppress initial message when loading a previous session.
      initialMessageDeliveredRef.current = true;
      const doLoad = async (): Promise<void> => {
        try {
          const token = authRef.current.getToken?.() ?? undefined;
          const detail = await getSessionHistory(serverUrl, sessionId, token);
          const chatMessages = rehydrateHistory(detail.messages);
          stream.dispatch({ type: 'LOAD_HISTORY', sessionId, messages: chatMessages });
        } catch (err) {
          stream.dispatch({
            type: 'STREAM_ERROR',
            message: err instanceof Error ? err.message : 'Failed to load session',
          });
        }
      };
      void doLoad();
    },
    // stream.dispatch is stable (React guarantees); serverUrl is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverUrl],
  );

  // Resume an existing session on mount (takes precedence over initialMessage).
  useEffect(() => {
    if (!resumeSessionId || resumeLoadedRef.current) return;
    resumeLoadedRef.current = true;
    initialMessageDeliveredRef.current = true;
    loadSession(resumeSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSessionId]);

  // Auto-send initialMessage once. Two refs:
  //   - `sent`: flips true once send() is called — prevents re-sends on
  //     re-renders caused by dependency changes.
  //   - `delivered`: flips true after the stream completes without abort —
  //     prevents re-sends after successful delivery. Stays false on abort
  //     (StrictMode unmount), allowing retry on remount.
  useEffect(() => {
    if (resumeSessionId) return;
    if (stream.sessionId && !initialMessage) return; // resumed session path
    if (!initialMessage || initialMessageDeliveredRef.current) return;
    initialMessageSentRef.current = false;

    const timer = setTimeout(() => {
      if (!initialMessageSentRef.current && !initialMessageDeliveredRef.current) {
        initialMessageSentRef.current = true;
        stream.send(initialMessage);
      }
    }, 0);
    return () => { clearTimeout(timer); };
  // Only depend on initialMessage — send changes when isStreaming toggles
  // and we don't want that to re-trigger the initial send.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // Flip `delivered` once the first send completes.
  useEffect(() => {
    if (
      initialMessage &&
      initialMessageSentRef.current &&
      !stream.isStreaming &&
      stream.messages.length > 0
    ) {
      initialMessageDeliveredRef.current = true;
    }
  }, [initialMessage, stream.isStreaming, stream.messages.length]);

  // ---------------------------------------------------------------------
  // submitAskUserResponse — POST answers then mark the ask_user block.
  // ---------------------------------------------------------------------

  const submitAskUserResponse = useCallback(
    (askId: string, answers: Record<string, string>): void => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      stream.dispatch({ type: 'ASK_USER_SUBMITTED', askId, answers });

      const doSubmit = async (): Promise<void> => {
        try {
          const token = authRef.current.getToken?.() ?? undefined;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          await fetch(`${serverUrl}/chat/sessions/${sid}/ask-user-response`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ask_id: askId, answers }),
          });
        } catch {
          // Non-critical: if this fails the server will time out the ask_user.
        }
      };
      void doSubmit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverUrl],
  );

  return {
    messages: stream.messages,
    send: stream.send,
    stop: stream.stop,
    isStreaming: stream.isStreaming,
    activeToolCalls: stream.activeToolCalls,
    session: { id: stream.sessionId },
    error: stream.error,
    reset: stream.reset,
    eventBus: stream.eventBus,
    submitAskUserResponse,
    loadSession,
    isHistorical: stream.isHistorical,
  };
}

// ---------------------------------------------------------------------------
// History rehydration — stored DB messages → ChatMessage shapes
// ---------------------------------------------------------------------------

type StoredMessage = Awaited<ReturnType<typeof getSessionHistory>>['messages'][number];

function rehydrateHistory(stored: readonly StoredMessage[]): ChatMessage[] {
  return stored.map((m): ChatMessage => {
    if (m.type === 'assistant_text') {
      const toolCalls: ToolCallInfo[] = (m.toolCalls ?? []).map((tc) => ({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        toolId: (tc['toolId'] as string) ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        toolName: (tc['toolName'] as string) ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        parameters: (tc['args'] as Record<string, unknown>) ?? {},
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        status: (tc['status'] as ToolCallInfo['status']) ?? 'success',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        duration_ms: tc['duration_ms'] as number | undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        error: tc['error'] as string | undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
        result: tc['result'] as string | undefined,
      }));

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored widgets from DB
      const widgets = (m.widgets ?? []) as unknown as Array<import('../types').WidgetInfo>;

      // Rebuild content blocks.
      const storedBlocks = m.contentBlocks;
      const contentBlocks: ContentBlock[] = [];
      if (storedBlocks && storedBlocks.length > 0) {
        const toolCallById = new Map(toolCalls.map((tc) => [tc.toolId, tc]));
        for (const block of storedBlocks) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored block from DB
          const blockType = block['type'] as string;
          if (blockType === 'text') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
            const text = block['text'] as string;
            if (text.length > 0) {
              contentBlocks.push({ type: 'text', text });
            }
          } else if (blockType === 'tool_calls') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
            const callIds = block['callIds'] as string[] | undefined;
            const calls = callIds
              ? callIds
                  .map((id) => toolCallById.get(id))
                  .filter((tc): tc is ToolCallInfo => tc != null)
              : toolCalls;
            if (calls.length > 0) {
              contentBlocks.push({ type: 'tool_calls', calls });
            }
          } else if (blockType === 'widget') {
            contentBlocks.push({
              type: 'widget',
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
              widgetType: block['widgetType'] as string,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored field
              data: (block['data'] as Record<string, unknown>) ?? {},
            });
          }
        }
      } else {
        // Legacy messages without stored contentBlocks.
        if (toolCalls.length > 0) contentBlocks.push({ type: 'tool_calls', calls: toolCalls });
        if (m.text.length > 0) contentBlocks.push({ type: 'text', text: m.text });
        for (const w of widgets) {
          contentBlocks.push({ type: 'widget', widgetType: w.widgetType, data: w.data });
        }
      }

      return {
        type: 'assistant_text',
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
      return { type: 'error', id: m.id, message: m.text, timestamp: m.timestamp };
    }
    return { type: 'user', id: m.id, text: m.text, timestamp: m.timestamp };
  });
}
