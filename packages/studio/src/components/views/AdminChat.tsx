/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin agent chat panel — uses the shared useChatStream hook from
 * @amodalai/react so it handles every SSE event type (tool_call_start,
 * tool_call_result, widgets, confirmations, etc.) the same way the
 * main chat page does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Send, Square, Bot, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import Markdown from 'react-markdown';
import { useChatStream, streamSSE } from '@amodalai/react';
import type { ChatMessage, ContentBlock, SSEEvent } from '@amodalai/react';
import { ToolCallCard } from '../ToolCallCard';

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
    return {
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- persisted shape validated at read
      messages: Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [],
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function persistChat(chat: PersistedChat): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
  } catch { /* quota exceeded / private browsing */ }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  if (elapsed < 1) return null;
  return <span className="text-muted-foreground font-mono tabular-nums text-xs">{String(elapsed)}s</span>;
}

function AssistantBlocks({ blocks, compact }: { blocks: ContentBlock[]; compact: boolean }) {
  const textScale = compact ? 'text-xs' : 'text-sm';
  return (
    <>
      {blocks.map((block, i) => {
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- admin chat only renders text + tool_calls
        switch (block.type) {
          case 'text':
            return (
              <div
                key={`t-${String(i)}`}
                className={`text-foreground prose prose-sm dark:prose-invert prose-pre:text-xs max-w-none ${textScale}`}
              >
                <Markdown>{block.text}</Markdown>
              </div>
            );
          case 'tool_calls':
            return (
              <div key={`tc-${String(i)}`}>
                {block.calls.map((call) => <ToolCallCard key={call.toolId} call={call} />)}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AdminChat({ compact = true }: { compact?: boolean }) {
  const initial = useRef<PersistedChat | null>(null);
  initial.current ??= loadPersistedChat();

  const [input, setInput] = useState('');
  const [streamStartTime, setStreamStartTime] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionIdRef = useRef<string | null>(initial.current.sessionId);

  const streamFn = useCallback(
    (text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => {
      const body: Record<string, unknown> = { message: text, app_id: 'admin' };
      if (sessionIdRef.current) body['session_id'] = sessionIdRef.current;
      // POST to Studio's admin-chat proxy which forwards to the admin agent
      return streamSSE('/api/studio/admin-chat/stream', body, { signal });
    },
    [],
  );

  const stream = useChatStream({ streamFn });

  // Hydrate from localStorage on first mount
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const persisted = initial.current;
    if (persisted && persisted.messages.length > 0) {
      stream.dispatch({
        type: 'LOAD_HISTORY',
        sessionId: persisted.sessionId ?? '',
        messages: persisted.messages,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  sessionIdRef.current = stream.sessionId ?? sessionIdRef.current;

  useEffect(() => {
    persistChat({ sessionId: stream.sessionId ?? sessionIdRef.current, messages: stream.messages });
  }, [stream.sessionId, stream.messages]);

  useEffect(() => {
    if (stream.isStreaming && streamStartTime === 0) {
      setStreamStartTime(Date.now());
    } else if (!stream.isStreaming && streamStartTime !== 0) {
      setStreamStartTime(0);
      inputRef.current?.focus();
    }
  }, [stream.isStreaming, streamStartTime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream.messages]);

  const sendText = useCallback(
    (text: string) => {
      if (!text || stream.isStreaming) return;
      stream.send(text);
    },
    [stream],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput('');
      sendText(text);
    },
    [input, sendText],
  );

  // Listen for programmatic sends (e.g. from Feedback synthesis)
  useEffect(() => {
    const handler = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CustomEvent detail
      const msg = (e as unknown as { detail?: string }).detail;
      if (msg) sendText(msg);
    };
    window.addEventListener('admin-chat-send', handler);
    return () => { window.removeEventListener('admin-chat-send', handler); };
  }, [sendText]);

  const handleReset = useCallback(() => {
    stream.reset();
    sessionIdRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
  }, [stream]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- keyboard→form event coercion
        handleSubmit(e as unknown as FormEvent);
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Reset */}
      {stream.messages.length > 0 && !stream.isStreaming && (
        <div className="flex items-center justify-end px-4 py-1.5 border-b border-border">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            New conversation
          </button>
        </div>
      )}

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto scrollbar-thin ${compact ? 'px-3 py-3' : 'px-6 py-4'}`}>
        {stream.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className={`${compact ? 'h-8 w-8 mb-3' : 'h-12 w-12 mb-4'} text-primary/30`} />
            <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-muted-foreground mb-2`}>Admin Agent</h2>
            <p className={`${compact ? 'text-xs' : 'text-sm'} text-muted-foreground max-w-md`}>
              Ask me to add connections, write skills, create automations, or validate your setup.
            </p>
          </div>
        )}

        {stream.messages.map((msg) => {
          if (msg.type === 'user') {
            return (
              <div key={msg.id} className="mb-4 flex justify-end">
                <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-primary-solid text-white ${compact ? 'text-xs' : 'text-sm'}`}>
                  {msg.text}
                </div>
              </div>
            );
          }
          if (msg.type === 'assistant_text') {
            return (
              <div key={msg.id} className="mb-4 max-w-[90%]">
                <AssistantBlocks blocks={msg.contentBlocks} compact={compact} />
              </div>
            );
          }
          if (msg.type === 'error') {
            return (
              <div key={msg.id} className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {msg.message}
              </div>
            );
          }
          return null;
        })}

        {stream.isStreaming && (
          <div className={`flex items-center gap-2 text-muted-foreground ${compact ? 'text-xs' : 'text-sm'} mb-3`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{stream.activeToolCalls.length > 0 ? 'Working...' : 'Thinking...'}</span>
            {streamStartTime > 0 && <ElapsedTimer startTime={streamStartTime} />}
          </div>
        )}

        {stream.error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 mb-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {stream.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`shrink-0 border-t border-border bg-card ${compact ? 'px-2 py-2' : 'px-4 py-3'}`}>
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${String(Math.min(e.target.scrollHeight, 200))}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={compact ? 'Message admin agent...' : 'Ask me to add a connection, write a skill, or validate your config...'}
            rows={1}
            className={`flex-1 resize-none rounded-xl border border-border bg-background ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'} text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors`}
            style={{ maxHeight: '200px', overflow: 'auto' }}
            disabled={stream.isStreaming}
          />
          {stream.isStreaming ? (
            <button
              type="button"
              onClick={stream.stop}
              className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded-xl flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80 transition-colors shrink-0`}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded-xl flex items-center justify-center bg-primary-solid text-white disabled:opacity-30 hover:bg-primary-solid/90 transition-colors shrink-0`}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
