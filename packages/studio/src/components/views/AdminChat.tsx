/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Chat UI lives in @amodalai/react/widget — feature changes go there, not here.
// This file is intentionally thin.

import { useCallback, useEffect, useRef } from 'react';
import { ChatWidget } from '@amodalai/react/widget';
import { streamSSE } from '@amodalai/react';
import type { SSEEvent, ChatMessage } from '@amodalai/react';
import { useTheme } from '../ThemeProvider';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'amodal-admin-chat-v2';

interface PersistedChat {
  sessionId: string | null;
  messages: ChatMessage[];
}

function loadPersistedChat(): PersistedChat {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessionId: null, messages: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { sessionId: null, messages: [] };

    const data = parsed as { sessionId?: unknown; messages?: unknown };
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];
    // Validate each element has the minimum ChatMessage shape (type + id)
    const validMessages = rawMessages.filter(
      (m: unknown): m is ChatMessage =>
        typeof m === 'object' && m !== null && 'type' in m && 'id' in m,
    );
    return {
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
      messages: validMessages,
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function persistChat(chat: PersistedChat): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
  } catch (err: unknown) {
    // eslint-disable-next-line no-console -- browser SPA, no structured logger; quota exceeded or private browsing
    console.warn('[AdminChat] persist_chat_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AdminChat({ compact = true }: { compact?: boolean }) {
  const { dark } = useTheme();
  const sessionIdRef = useRef<string | null>(loadPersistedChat().sessionId);

  const streamFn = useCallback(
    (text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => {
      const body: Record<string, unknown> = { message: text, app_id: 'admin' };
      if (sessionIdRef.current) body['session_id'] = sessionIdRef.current;
      return streamSSE('/api/studio/admin-chat/stream', body, { signal });
    },
    [],
  );

  const handleStateChange = useCallback(
    (state: { sessionId: string | null; messages: ChatMessage[] }) => {
      sessionIdRef.current = state.sessionId ?? sessionIdRef.current;
      persistChat({ sessionId: sessionIdRef.current, messages: state.messages });
    },
    [],
  );

  // Listen for programmatic sends (e.g. from Feedback synthesis)
  const widgetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      if (!('detail' in e)) return;
      // After the `in` guard, access the property via index to avoid type assertions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting detail from CustomEvent-like Event
      const obj = e as unknown as Record<string, unknown>;
      const detail: unknown = obj['detail'];
      if (typeof detail === 'string' && widgetRef.current) {
        // Dispatch an input event to ChatWidget's InputBar
        const input = widgetRef.current.querySelector('textarea');
        if (input) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value',
          )?.set;
          nativeInputValueSetter?.call(input, detail);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          // Submit via form
          const form = input.closest('form');
          form?.requestSubmit();
        }
      }
    };
    window.addEventListener('admin-chat-send', handler);
    return () => { window.removeEventListener('admin-chat-send', handler); };
  }, []);

  return (
    <div ref={widgetRef} className="h-full">
      <ChatWidget
        serverUrl=""
        user={{ id: 'admin' }}
        position="inline"
        defaultOpen
        showInput
        streamFn={streamFn}
        onStateChange={handleStateChange}
        theme={{
          mode: dark ? 'dark' : 'light',
          headerText: 'Admin Agent',
          emptyStateText: 'Ask me to add connections, write skills, create automations, or validate your setup.',
          placeholder: compact ? 'Message admin agent...' : 'Ask me to add a connection, write a skill, or validate your config...',
        }}
      />
    </div>
  );
}
