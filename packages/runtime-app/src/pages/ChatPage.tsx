/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Chat UI lives in @amodalai/react/widget — feature changes go there, not here.
// This file is intentionally thin. If you need a new chat feature, add it to ChatWidget.

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { ChatWidget } from '@amodalai/react/widget';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useAuth } from '@/hooks/useAuth';

const RUNTIME_URL = window.location.origin;

/** Type guard for location state carrying a newChat key. */
function hasNewChat(state: unknown): state is { newChat: unknown } {
  return typeof state === 'object' && state !== null && 'newChat' in state;
}

/**
 * Bridge async token getter to a sync getter by caching the last resolved value.
 * The widget's useChat hook calls getToken synchronously; we pre-fetch and cache.
 */
function useSyncToken(asyncGetToken: (() => Promise<string>) | undefined): (() => string | null) | undefined {
  const cachedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!asyncGetToken) return;
    void asyncGetToken().then((t) => { cachedRef.current = t; });
  }, [asyncGetToken]);

  const syncGetter = useCallback((): string | null => cachedRef.current, []);

  return asyncGetToken ? syncGetter : undefined;
}

export function ChatPage() {
  const { resumeSessionId: serverResumeId } = useRuntimeManifest();
  const { getToken: asyncGetToken } = useAuth();
  const getToken = useSyncToken(asyncGetToken);
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
        mode: 'dark',
        headerText: agentName || undefined,
      }}
    />
  );
}
