/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Chat hook for runtime-app consumers that go through the provider-based
 * `AmodalClient`. Thin wrapper around `useChatStream` — the canonical
 * reducer + SSE event loop lives there. All this hook does is:
 *   - take the `initialSessionId` / `context` options
 *   - build a streamFn from `client.chatStream(...)`
 *   - expose a slightly different return shape (sessionId + usage as
 *     top-level fields) matching the prior public API
 *
 * The public API (UseAmodalChatOptions, UseAmodalChatReturn) is
 * unchanged from earlier versions; this file used to carry its own
 * copy of the reducer + event loop.
 */
import { useCallback, useRef } from 'react';
import type {
  ChatMessage,
  ToolCallInfo,
  ConfirmationInfo,
  SSEEvent,
} from '../types';
import { useAmodalContext } from '../provider';
import { useChatStream } from './useChatStream';

export { chatReducer } from './useChatStream';

// ---------------------------------------------------------------------------
// Public API (unchanged)
// ---------------------------------------------------------------------------

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
  usage: { inputTokens: number; outputTokens: number };
  reset: () => void;
  respondToConfirmation: (correlationId: string, approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAmodalChat(options?: UseAmodalChatOptions): UseAmodalChatReturn {
  const { client } = useAmodalContext();

  // Keep a ref to the caller's options so the streamFn closure reads the
  // latest context + session id on every send() without needing send() to
  // change identity (and thereby re-trigger effects downstream).
  const optsRef = useRef(options);
  optsRef.current = options;

  // sessionId comes back from useChatStream's state on each STREAM_INIT.
  // The initial value can come from options.initialSessionId. We mirror
  // useChatStream's state through a ref so streamFn picks up the latest
  // value (or the initial one before any stream has completed).
  const sessionIdRef = useRef<string | null>(options?.initialSessionId ?? null);

  const streamFn = useCallback(
    (text: string, signal: AbortSignal): AsyncIterable<SSEEvent> =>
      client.chatStream(text, {
        ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
        ...(optsRef.current?.context ? { context: optsRef.current.context } : {}),
        signal,
      }),
    [client],
  );

  const stream = useChatStream({
    streamFn,
    ...(options?.onStreamEnd ? { onStreamEnd: options.onStreamEnd } : {}),
    ...(options?.onSessionCreated ? { onSessionCreated: options.onSessionCreated } : {}),
    ...(options?.onToolCall ? { onToolCall: options.onToolCall } : {}),
    ...(options?.onConfirmation ? { onConfirmation: options.onConfirmation } : {}),
  });

  // Pull the live session id forward so the next send() reuses it.
  sessionIdRef.current = stream.sessionId ?? sessionIdRef.current;

  return {
    messages: stream.messages,
    send: stream.send,
    stop: stream.stop,
    isStreaming: stream.isStreaming,
    activeToolCalls: stream.activeToolCalls,
    sessionId: stream.sessionId,
    error: stream.error,
    usage: stream.usage,
    reset: stream.reset,
    respondToConfirmation: stream.respondToConfirmation,
  };
}
