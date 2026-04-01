/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Send, Loader2, Bot, AlertCircle } from 'lucide-react';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'amodal-admin-chat';

function loadPersistedChat(): { sessionId: string | null; messages: Message[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessionId: null, messages: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { sessionId: null, messages: [] };
     
    const data = parsed as { sessionId?: unknown; messages?: unknown };
    return {
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- messages shape validated by caller context
      messages: Array.isArray(data.messages) ? (data.messages as Message[]) : [],
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function persistChat(sessionId: string | null, messages: Message[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, messages }));
  } catch { /* quota exceeded or private browsing */ }
}

export function AdminChatPanel({ compact }: { compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>(() => loadPersistedChat().messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => loadPersistedChat().sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Persist conversation to localStorage
  useEffect(() => { persistChat(sessionId, messages); }, [sessionId, messages]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setIsStreaming(true);

    // Add empty assistant message that we'll stream into
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    const resp = await fetch('/config/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        app_id: 'admin',
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    });

    if (!resp.ok || !resp.body) {
      setError(`Request failed: ${String(resp.status)}`);
      setIsStreaming(false);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          const event: unknown = JSON.parse(json);
          if (!event || typeof event !== 'object') continue;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
          const ev = event as Record<string, unknown>;
          const type = String(ev['type'] ?? '');

          if (type === 'init' && typeof ev['session_id'] === 'string') {
            setSessionId(ev['session_id']);
          } else if (type === 'text_delta' && typeof ev['content'] === 'string') {
            const deltaText = ev['content'];
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + deltaText };
              }
              return updated;
            });
          } else if (type === 'error') {
            setError(typeof ev['message'] === 'string' ? ev['message'] : 'Unknown error');
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, isStreaming, sessionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- keyboard event as form event
      void handleSubmit(e as unknown as FormEvent);
    }
  }, [handleSubmit]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className={`flex-1 overflow-y-auto scrollbar-thin ${compact ? 'px-3 py-3' : 'px-6 py-4'}`}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className={`${compact ? 'h-8 w-8 mb-3' : 'h-12 w-12 mb-4'} text-indigo-500/30`} />
            <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-gray-400 dark:text-white/40 mb-2`}>Admin Agent</h2>
            <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-400 dark:text-white/25 max-w-md`}>
              Ask me to add connections, write skills, create automations, or validate your setup.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`mb-4 ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
            {msg.role === 'user' ? (
              <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-indigo-600 text-white ${compact ? 'text-xs' : 'text-sm'}`}>
                {msg.content}
              </div>
            ) : (
              <div className={`max-w-[90%] ${compact ? 'text-xs' : 'text-sm'} text-gray-800 dark:text-white/80 prose prose-sm dark:prose-invert prose-pre:bg-gray-100 dark:prose-pre:bg-zinc-800 prose-pre:text-xs max-w-none`}>
                <Markdown>{msg.content}</Markdown>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 mb-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className={`shrink-0 border-t border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17] ${compact ? 'px-2 py-2' : 'px-4 py-3'}`}>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={compact ? 'Message admin agent...' : 'Ask me to add a connection, write a skill, or validate your config...'}
            rows={1}
            className={`flex-1 resize-none rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/[0.04] ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'} text-gray-900 dark:text-white/90 placeholder-gray-400 dark:placeholder-white/25 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500/50 transition-colors`}
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded-xl flex items-center justify-center bg-indigo-600 text-white disabled:opacity-30 hover:bg-indigo-500 transition-colors shrink-0`}
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Full-page config chat — used as the /config index route */
export function ConfigChatPage() {
  return <AdminChatPanel />;
}
