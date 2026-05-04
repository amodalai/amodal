/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { WidgetConfig, SSEEvent, InlineBlockRendererRegistry, ChatAction } from '../types';
import type { InteractionEvent } from '../events/types';
import type { WidgetRegistry } from './widgets/WidgetRenderer';
import { useChat } from '../hooks/useChat';
import { useChatStream } from '../hooks/useChatStream';
import { useSessionHistory } from '../hooks/useSessionHistory';
import { applyTheme, mergeTheme } from '../theme';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { SessionHistory } from './SessionHistory';
import './widget.css';

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export interface ChatWidgetHandle {
  /** Send a message in the current session, as if the user typed it. */
  sendMessage: (text: string) => void;
  /** Get the current session ID. */
  getSessionId: () => string | null;
}

export type ChatWidgetProps = WidgetConfig & {
  widgets?: WidgetRegistry;
  /** Enable session history drawer. */
  historyEnabled?: boolean;
  /** Show thumbs up/down feedback buttons on assistant messages. Defaults to false. */
  showFeedback?: boolean;
  /** Show the header bar with title and controls. Defaults to true. */
  showHeader?: boolean;
  /**
   * Custom transport function. When provided, bypasses the standard useChat
   * hook (which calls /chat/stream) and uses useChatStream directly. Use
   * this for non-standard endpoints (e.g. admin agent, config chat).
   */
  streamFn?: (text: string, signal: AbortSignal, images?: Array<{mimeType: string; data: string}>) => AsyncIterable<SSEEvent>;
  /** Called when session state changes (for external persistence). */
  onStateChange?: (state: { sessionId: string | null; messages: Array<import('../types').ChatMessage> }) => void;
  /**
   * Optional Studio-supplied renderers for non-native block types
   * (Phase H.2). The widget falls back to this registry only for
   * block types it doesn't render itself (today: `connection_panel`).
   * Native types (text, ask_choice, proposal, etc.) cannot be
   * overridden — that's the contract that keeps the widget honest.
   */
  inlineBlockRenderers?: InlineBlockRendererRegistry;
  /**
   * Optional handle exposed once on first render so embedders can
   * drive the reducer from outside (Phase H.10 — Studio's
   * connection-panel reconciliation runs from `<AdminChat>` rather
   * than from inside the panel renderer). Callback shape rather
   * than a ref so consumers don't have to deal with a ref dance.
   */
  onReady?: (handle: { dispatch: (action: ChatAction) => void }) => void;
};

export const ChatWidget = forwardRef<ChatWidgetHandle, ChatWidgetProps>(({
  serverUrl,
  user,
  getToken,
  theme,
  position = 'floating',
  defaultOpen = false,
  onToolCall,
  onKBProposal,
  onEvent,
  entityExtractors,
  widgets: customWidgets,
  historyEnabled = false,
  showFeedback = false,
  showHeader = true,
  showInput = true,
  sessionType,
  deployId,
  scopeId,
  scopeContext,
  initialMessage,
  resumeSessionId,
  onStreamEnd,
  onSessionCreated,
  streamFn: customStreamFn,
  onStateChange,
  inlineBlockRenderers,
  onReady,
}: ChatWidgetProps, ref: React.ForwardedRef<ChatWidgetHandle>) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showHistory, setShowHistory] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mergedTheme = mergeTheme(theme);

  // When streamFn is provided, use useChatStream directly (custom transport).
  // Otherwise use the standard useChat which calls /chat/stream.
  const chatHook = useChat({
    serverUrl,
    user,
    getToken,
    onToolCall,
    onKBProposal,
    onEvent,
    entityExtractors,
    sessionType,
    deployId,
    scopeId,
    scopeContext,
    initialMessage,
    resumeSessionId,
    onStreamEnd,
    onSessionCreated,
  });

  const directStream = useChatStream({
    streamFn: customStreamFn ?? (() => (async function* () { /* noop */ })()),
    onToolCall,
    onKBProposal,
    onEvent,
    onStreamEnd,
    onSessionCreated,
    entityExtractors,
  });

  // Pick the appropriate hook output based on whether a custom streamFn was provided.
  const active = customStreamFn ? directStream : chatHook;
  const { messages, send, stop, isStreaming, error, reset, eventBus, respondToConfirmation, isHistorical, dispatch } = active;
  const noopAskUser = useCallback((_askId: string, _answers: Record<string, string>) => { /* noop */ }, []);
  const noopAskChoice = useCallback((_askId: string, _values: string[], message: string) => {
    // Custom streamFn flows can still send the value as a normal user turn —
    // we just can't mark the block submitted because we don't own the reducer.
    void send(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is stable across renders for this hook
  }, []);
  const noopProposal = useCallback(
    (_proposalId: string, _answer: 'confirm' | 'adjust', message: string) => {
      // Same shape as noopAskChoice: customStreamFn embedders post the
      // chosen text as a regular user turn but can't lock the buttons
      // because we don't own their reducer.
      void send(message);

    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is stable across renders for this hook
    [],
  );
  const noopLoadSession = useCallback((_sessionId: string) => { /* noop */ }, []);
  const submitAskUserResponse = customStreamFn ? noopAskUser : chatHook.submitAskUserResponse;
  const submitAskChoiceResponse = customStreamFn ? noopAskChoice : chatHook.submitAskChoiceResponse;
  const submitProposalResponse = customStreamFn ? noopProposal : chatHook.submitProposalResponse;
  const loadSession = customStreamFn ? noopLoadSession : chatHook.loadSession;
  const session = customStreamFn ? { id: directStream.sessionId } : chatHook.session;

  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => { send(text); },
    getSessionId: () => session.id ?? null,
  }), [send, session.id]);

  // Auto-send initialMessage on the customStreamFn path. The default path
  // already handles this inside `useChat`; this catch-up is for embedders
  // (like Studio's AdminChat) that supply their own streamFn and would
  // otherwise miss the auto-send. Fires exactly once per widget instance.
  const customInitialSentRef = useRef(false);
  useEffect(() => {
    if (!customStreamFn || !initialMessage) return;
    if (customInitialSentRef.current) return;
    if (messages.length > 0) return;
    customInitialSentRef.current = true;
    const timer = setTimeout(() => { send(initialMessage); }, 0);
    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customStreamFn, initialMessage]);

  // Track elapsed time during streaming
  const [streamStartTime, setStreamStartTime] = useState(0);
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      setStreamStartTime(Date.now());
    } else if (!isStreaming && prevStreamingRef.current) {
      setStreamStartTime(0);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Notify parent of state changes (for external persistence like localStorage).
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.({ sessionId: session.id ?? null, messages });
  }, [session.id, messages]);

  // Phase H.10 — expose the dispatch handle to embedders once on
  // first mount so they can run external reductions (Studio's
  // connection-panel reconciliation pass against
  // /api/connections-status). Fired exactly once per widget instance;
  // re-firing on every render would invalidate the embedder's
  // useCallback / ref captures and force re-mount loops.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.({ dispatch });
  }, [dispatch]);

  const history = useSessionHistory({
    serverUrl,
    getToken,
    enabled: historyEnabled && showHistory,
  });

  const handleInteraction = useCallback(
    (event: InteractionEvent) => {
      eventBus.emitInteraction(event);
      onEvent?.(event);
    },
    [eventBus, onEvent],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      loadSession(sessionId);
      setShowHistory(false);
    },
    [loadSession],
  );

  const handleNewChat = useCallback(() => {
    reset();
    setShowHistory(false);
  }, [reset]);

  // Apply theme as CSS custom properties
  useEffect(() => {
    if (containerRef.current && theme) {
      applyTheme(containerRef.current, theme);
    }
  }, [theme]);

  const positionClass = `pcw-widget pcw-widget--${position}`;
  const themeMode = theme?.mode;
  const dataTheme = themeMode && themeMode !== 'auto' ? themeMode : undefined;

  // Inline mode is always visible
  if (position === 'inline') {
    return (
      <div ref={containerRef} className={positionClass} data-testid="chat-widget" data-theme={dataTheme}>
        {showHeader && (
          <ChatHeader
            title={mergedTheme.headerText}
            onReset={reset}
            historyEnabled={historyEnabled}
            onToggleHistory={() => setShowHistory((v) => !v)}
            isHistorical={isHistorical}
          />
        )}
        {showHistory && (
          <SessionHistory
            sessions={history.sessions}
            isLoading={history.isLoading}
            allTags={history.allTags}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onClose={() => setShowHistory(false)}
            onUpdateTags={history.updateTags}
            onUpdateTitle={history.updateTitle}
            onDeleteSession={history.removeSession}
          />
        )}
        <MessageList messages={messages} isStreaming={isStreaming} streamStartTime={streamStartTime} sendMessage={send} customWidgets={customWidgets} onInteraction={handleInteraction} onAskUserSubmit={submitAskUserResponse} onAskChoiceSubmit={submitAskChoiceResponse} onProposalSubmit={submitProposalResponse} onConfirmationRespond={respondToConfirmation} emptyStateText={mergedTheme.emptyStateText} sessionId={session.id ?? undefined} showFeedback={showFeedback} verboseTools={mergedTheme.verboseTools} inlineBlockRenderers={inlineBlockRenderers} dispatch={dispatch} />
        {error && <div className="pcw-error">{error}</div>}
        {showInput && (
          <InputBar
            onSend={send}
            onStop={stop}
            disabled={isStreaming}
            isStreaming={isStreaming}
            placeholder={isHistorical ? 'Send a message to start a new chat...' : mergedTheme.placeholder}
          />
        )}
      </div>
    );
  }

  // For non-inline positions, support open/close toggle
  if (!isOpen) {
    if (position === 'floating') {
      return (
        <button
          type="button"
          className="pcw-toggle"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <ChatIcon />
        </button>
      );
    }
    return null;
  }

  return (
    <div ref={containerRef} className={positionClass} data-testid="chat-widget" data-theme={dataTheme}>
      {showHeader && (
        <ChatHeader
          title={mergedTheme.headerText}
          onClose={() => setIsOpen(false)}
          onReset={reset}
          showClose
          historyEnabled={historyEnabled}
          onToggleHistory={() => setShowHistory((v) => !v)}
          isHistorical={isHistorical}
        />
      )}
      {showHistory && (
        <SessionHistory
          sessions={history.sessions}
          isLoading={history.isLoading}
          allTags={history.allTags}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onClose={() => setShowHistory(false)}
          onUpdateTags={history.updateTags}
        />
      )}
      <MessageList messages={messages} isStreaming={isStreaming} streamStartTime={streamStartTime} sendMessage={send} customWidgets={customWidgets} onInteraction={handleInteraction} onAskUserSubmit={submitAskUserResponse} onAskChoiceSubmit={submitAskChoiceResponse} onProposalSubmit={submitProposalResponse} onConfirmationRespond={respondToConfirmation} emptyStateText={mergedTheme.emptyStateText} sessionId={session.id ?? undefined} showFeedback={showFeedback} verboseTools={mergedTheme.verboseTools} inlineBlockRenderers={inlineBlockRenderers} dispatch={dispatch} />
      {error && <div className="pcw-error">{error}</div>}
      {showInput && (
        <InputBar
          onSend={send}
          onStop={stop}
          disabled={isStreaming}
          isStreaming={isStreaming}
          placeholder={isHistorical ? 'Send a message to start a new chat...' : mergedTheme.placeholder}
        />
      )}
    </div>
  );
});
ChatWidget.displayName = 'ChatWidget';

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

interface ChatHeaderProps {
  title: string;
  onClose?: () => void;
  onReset?: () => void;
  showClose?: boolean;
  historyEnabled?: boolean;
  onToggleHistory?: () => void;
  isHistorical?: boolean;
}

function ChatHeader({ title, onClose, onReset, showClose = false, historyEnabled, onToggleHistory, isHistorical }: ChatHeaderProps) {
  return (
    <div className="pcw-header">
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {historyEnabled && onToggleHistory && (
          <button
            type="button"
            className="pcw-header__close"
            onClick={onToggleHistory}
            aria-label="Session history"
            title="Session history"
          >
            <HistoryIcon />
          </button>
        )}
        <h3 className="pcw-header__title">
          {title}
          {isHistorical && <span className="pcw-header__badge">History</span>}
        </h3>
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {onReset && (
          <button
            type="button"
            className="pcw-header__close"
            onClick={onReset}
            aria-label="New conversation"
            title="New conversation"
          >
            {'\u21BB'}
          </button>
        )}
        {showClose && onClose && (
          <button
            type="button"
            className="pcw-header__close"
            onClick={onClose}
            aria-label="Close chat"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}
