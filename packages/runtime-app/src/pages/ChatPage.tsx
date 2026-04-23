/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Chat UI lives in @amodalai/react/widget — feature changes go there, not here.
// This file is intentionally thin. If you need a new chat feature, add it to ChatWidget.

import { useMemo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { ChatWidget } from '@amodalai/react/widget';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useAuth } from '@/hooks/useAuth';

/** Subscribe to .dark class changes on <html> so the chat widget theme stays in sync. */
function useDarkMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const observer = new MutationObserver(cb);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    },
    () => document.documentElement.classList.contains('dark'),
  );
}

const RUNTIME_URL = window.location.origin;

/** Type guard for location state carrying a newChat key. */
function hasNewChat(state: unknown): state is { newChat: unknown } {
  return typeof state === 'object' && state !== null && 'newChat' in state;
}

export function ChatPage() {
  const { resumeSessionId: serverResumeId } = useRuntimeManifest();
  const { token, getToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlResumeId = searchParams.get('resume');
  const initialPrompt = searchParams.get('prompt');
  const activeResumeId = useMemo(() => urlResumeId ?? serverResumeId, [urlResumeId, serverResumeId]);

  const location = useLocation();
  const locState: unknown = location.state;
  const newChatKey = hasNewChat(locState) ? locState.newChat : undefined;

  // Generate a key that forces ChatWidget to remount on session change or new chat.
  const [widgetKey, setWidgetKey] = useState(0);
  const prevResumeRef = useRef(activeResumeId);
  const prevNewChatRef = useRef(newChatKey);
  useEffect(() => {
    const resumeChanged = prevResumeRef.current !== activeResumeId;
    const newChatClicked = prevNewChatRef.current !== newChatKey;
    prevResumeRef.current = activeResumeId;
    prevNewChatRef.current = newChatKey;
    if (resumeChanged || newChatClicked) {
      setWidgetKey((k) => k + 1);
    }
  }, [activeResumeId, newChatKey]);

  // Clear prompt from URL after first render to avoid re-sending on refresh.
  const promptCleared = useRef(false);
  useEffect(() => {
    if (initialPrompt && !promptCleared.current) {
      promptCleared.current = true;
      searchParams.delete('prompt');
      setSearchParams(searchParams, { replace: true });
    }
  }, [initialPrompt, searchParams, setSearchParams]);

  const { name: agentName } = useRuntimeManifest();
  const isDark = useDarkMode();

  if (!token) return null;

  return (
    <ChatWidget
      key={widgetKey}
      serverUrl={RUNTIME_URL}
      user={{ id: 'anonymous' }}
      getToken={getToken}
      position="inline"
      historyEnabled={true}
      showFeedback={true}
      showHeader={false}
      resumeSessionId={activeResumeId ?? undefined}
      initialMessage={initialPrompt ?? undefined}
      theme={{
        mode: isDark ? 'dark' : 'light',
        headerText: agentName || undefined,
      }}
    />
  );
}
