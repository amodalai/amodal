/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createBrowserLogger } from '@/lib/browser-logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatToolCall {
  name: string;
  params: Record<string, unknown>;
  result?: string;
  status?: 'running' | 'success' | 'error';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ChatToolCall[];
}

export interface UseAdminChat {
  messages: ChatMessage[];
  isStreaming: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'studio-admin-chat';
const SESSION_KEY = 'studio-admin-chat-session';
const PROXY_ENDPOINT = '/api/studio/admin-chat/stream';

const log = createBrowserLogger('useAdminChat');

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated: parsed is an array from localStorage we wrote
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated shape above
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    log.warn('save_messages_failed', { count: messages.length });
  }
}

function loadSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_KEY);
}

function saveSessionId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, id);
}

function generateSessionId(): string {
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// SSE line parser
// ---------------------------------------------------------------------------

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return null;
  const json = trimmed.slice(6);
  if (json === '[DONE]') return { type: 'done', data: {} };
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      // After the typeof/null/in checks, parsed is `object & Record<"type", unknown>`.
      // We need Record<string, unknown> to index arbitrary keys for SSE data.
      const obj: Record<string, unknown> = Object.assign({}, parsed);
      const evtType = typeof obj['type'] === 'string' ? obj['type'] : '';
      return { type: evtType, data: obj };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminChat(): UseAdminChat {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(loadSessionId());

  // Listen for programmatic sends via custom event
  useEffect(() => {
    function handleExternalSend(e: Event): void {
      // CustomEvents carry a `detail` property — access via `in` check to avoid casts
      if (!('detail' in e)) return;
      const detail: unknown = e.detail;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const obj: Record<string, unknown> = Object.assign({}, detail);
        if (typeof obj['message'] === 'string') {
          void sendMessage(obj['message']);
        }
      }
    }
    window.addEventListener('admin-chat-send', handleExternalSend);
    return () => window.removeEventListener('admin-chat-send', handleExternalSend);
    // sendMessage is stable via useCallback with no deps that change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return;

    // Ensure we have a session ID
    if (!sessionIdRef.current) {
      const id = generateSessionId();
      sessionIdRef.current = id;
      saveSessionId(id);
    }

    // Add user message
    const userMessage: ChatMessage = { role: 'user', content: text };
    const assistantMessage: ChatMessage = { role: 'assistant', content: '', toolCalls: [] };

    setMessages((prev) => {
      const next = [...prev, userMessage, assistantMessage];
      saveMessages(next);
      return next;
    });
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(PROXY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        log.error('stream_request_failed', { status: response.status });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') {
            last.content = 'Failed to reach admin agent. Please try again.';
          }
          saveMessages(next);
          return next;
        });
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const evt = parseSSELine(line);
          if (!evt) continue;

          switch (evt.type) {
            case 'text_delta': {
              const delta = typeof evt.data['text'] === 'string' ? evt.data['text'] : '';
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  last.content += delta;
                }
                return [...next];
              });
              break;
            }
            case 'tool_call_start': {
              const toolName = typeof evt.data['toolName'] === 'string' ? evt.data['toolName'] : 'unknown';
              const rawParams = evt.data['parameters'];
              const params: Record<string, unknown> =
                typeof rawParams === 'object' && rawParams !== null
                  ? Object.assign({}, rawParams)
                  : {};
              const toolCall: ChatToolCall = { name: toolName, params, status: 'running' };
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  last.toolCalls = [...(last.toolCalls ?? []), toolCall];
                }
                return [...next];
              });
              break;
            }
            case 'tool_call_result': {
              const toolName = typeof evt.data['toolName'] === 'string' ? evt.data['toolName'] : '';
              const result = typeof evt.data['result'] === 'string' ? evt.data['result'] : '';
              const status = evt.data['error'] ? 'error' : 'success';
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant' && last.toolCalls) {
                  // Find the last tool call with this name that's still running
                  for (let i = last.toolCalls.length - 1; i >= 0; i--) {
                    if (last.toolCalls[i].name === toolName && last.toolCalls[i].status === 'running') {
                      last.toolCalls[i] = { ...last.toolCalls[i], result, status };
                      break;
                    }
                  }
                }
                return [...next];
              });
              break;
            }
            case 'done': {
              // Stream complete
              break;
            }
            default:
              // Ignore unknown event types
              break;
          }
        }
      }

      // Persist after streaming completes
      setMessages((prev) => {
        saveMessages(prev);
        return prev;
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — not an error
        setMessages((prev) => {
          saveMessages(prev);
          return prev;
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log.error('stream_error', { message });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && !last.content) {
            last.content = 'An error occurred while streaming the response.';
          }
          saveMessages(next);
          return next;
        });
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsStreaming(false);
    sessionIdRef.current = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  return { messages, isStreaming, send: sendMessage, stop, reset };
}
