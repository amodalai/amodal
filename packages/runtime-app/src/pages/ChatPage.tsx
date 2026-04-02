/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { FormEvent } from 'react';
import { Send, Square, Loader2, CheckCircle2, XCircle, Wrench, Pencil, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useSearchParams, useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useAmodalChat } from '@amodalai/react';
import type { ToolCallInfo, ContentBlock, ConfirmationInfo } from '@amodalai/react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';

function FeedbackButtons({ messageId, sessionId, query, response, toolCalls, model }: {
  messageId: string;
  sessionId?: string;
  query: string;
  response: string;
  toolCalls?: string[];
  model?: string;
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');

  const submit = (r: 'up' | 'down', c?: string) => {
    setRating(r);
    setShowComment(false);
    fetch('/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sessionId: sessionId ?? '', messageId, rating: r, comment: c, query, response, toolCalls, model}),
    }).catch(() => {});
  };

  const clear = () => {
    setRating(null);
    setShowComment(false);
    setComment('');
  };

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => rating === 'up' ? clear() : submit('up')}
          className={`p-1 rounded transition-colors ${rating === 'up' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-300 dark:text-zinc-600 hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-zinc-800/50'}`}
          title={rating === 'up' ? 'Undo' : 'Good response'}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            if (rating === 'down') {
              clear();
            } else if (showComment) {
              submit('down', comment || undefined);
            } else {
              setShowComment(true);
            }
          }}
          className={`p-1 rounded transition-colors ${rating === 'down' ? 'text-red-400 bg-red-500/10' : 'text-gray-300 dark:text-zinc-600 hover:text-red-400 hover:bg-gray-100 dark:hover:bg-zinc-800/50'}`}
          title={rating === 'down' ? 'Undo' : 'Bad response'}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {showComment && (
        <div className="mt-1.5 flex gap-2 items-start">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit('down', comment || undefined); }}
            placeholder="What went wrong? (optional)"
            className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800/50 text-gray-700 dark:text-zinc-300 placeholder:text-gray-400 dark:placeholder:text-zinc-600"
            autoFocus
          />
          <button
            onClick={() => submit('down', comment || undefined)}
            className="text-xs px-2 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-500',
  POST: 'text-emerald-500',
  PUT: 'text-amber-500',
  PATCH: 'text-amber-500',
  DELETE: 'text-red-500',
};

function formatParams(params: Record<string, unknown>): string {
  // For request tool, skip meta fields and show the interesting ones
  const skip = new Set(['connection', 'method', 'path', 'intent', 'body']);
  const entries = Object.entries(params).filter(([k]) => !skip.has(k));
  if (entries.length === 0 && params['body'] && typeof params['body'] === 'object') {
    // Show body keys instead
    const bodyKeys = Object.keys(params['body'] as unknown as Record<string, unknown>).slice(0, 3); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
    return bodyKeys.map((k) => k).join(', ');
  }
  return entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    const truncated = val.length > 30 ? val.slice(0, 27) + '...' : val;
    return `${k}: ${truncated}`;
  }).join('  ');
}

function ToolCallCard({ call }: { call: ToolCallInfo }) {
  const isRunning = call.status === 'running';
  const isError = call.status === 'error';
  const params = call.parameters ?? {};

  // Request tool — show connection, method, path
  const isRequest = call.toolName === 'request' && typeof params['connection'] === 'string';
  const connection = isRequest ? String(params['connection']) : null;
  const method = isRequest ? String(params['method'] ?? 'GET').toUpperCase() : null;
  const path = isRequest ? String(params['path'] ?? '') : null;
  const paramLine = isRequest ? formatParams(params) : null;

  if (isRequest && connection) {
    return (
      <div className="my-1.5 rounded-lg bg-gray-50 dark:bg-zinc-800/40 border border-gray-200 dark:border-zinc-700/40 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
          ) : isError ? (
            <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="text-[13px] font-semibold text-gray-800 dark:text-zinc-200">{connection}</span>
          {method && (
            <span className={`text-[10px] font-mono font-bold ${METHOD_COLORS[method] ?? 'text-gray-500'}`}>
              {method}
            </span>
          )}
          {path && (
            <span className="text-[12px] font-mono text-gray-500 dark:text-zinc-400 truncate">{path}</span>
          )}
          {call.duration_ms != null && (
            <span className="text-[11px] text-gray-400 dark:text-zinc-500 ml-auto tabular-nums shrink-0">{String(call.duration_ms)}ms</span>
          )}
        </div>
        {paramLine && (
          <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-zinc-500 font-mono truncate">
            {paramLine}
          </div>
        )}
      </div>
    );
  }

  // Generic tool call — compact badge
  return (
    <div className="flex items-center gap-2 px-3 py-2 my-1.5 rounded-lg bg-gray-50 dark:bg-zinc-800/40 border border-gray-200 dark:border-zinc-700/40 text-xs font-mono">
      {isRunning ? (
        <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
      ) : isError ? (
        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      )}
      <span className="text-blue-700 dark:text-blue-300 font-semibold">{call.toolName}</span>
      {call.duration_ms != null && (
        <span className="text-zinc-500 ml-auto">{String(call.duration_ms)}ms</span>
      )}
    </div>
  );
}

function ConfirmationCard({ confirmation, onApprove, onDeny }: {
  confirmation: ConfirmationInfo;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const resolved = confirmation.status === 'approved' || confirmation.status === 'denied';
  return (
    <div className="my-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-300 mb-1">
        <Wrench className="h-4 w-4" />
        <span className="uppercase text-[11px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded">
          {confirmation.method}
        </span>
        <span className="text-zinc-300">{confirmation.endpoint}</span>
      </div>
      {confirmation.reason && (
        <p className="text-xs text-zinc-400 mb-2">{confirmation.reason}</p>
      )}
      {!resolved ? (
        <div className="flex gap-2">
          <button onClick={onApprove} className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
            Approve
          </button>
          <button onClick={onDeny} className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 text-zinc-300 border border-zinc-600 hover:bg-zinc-600 transition-colors">
            Deny
          </button>
        </div>
      ) : (
        <span className={`text-xs font-semibold ${confirmation.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
          {confirmation.status === 'approved' ? 'Approved' : 'Denied'}
        </span>
      )}
    </div>
  );
}

function MessageContent({ blocks, respondToConfirmation }: {
  blocks: ContentBlock[];
  respondToConfirmation: (id: string, approved: boolean) => void;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <div key={`t-${String(i)}`} className="prose dark:prose-invert prose-sm max-w-none prose-headings:text-gray-900 dark:prose-headings:text-zinc-200 prose-p:text-gray-900 dark:prose-p:text-zinc-300 prose-strong:text-gray-900 dark:prose-strong:text-zinc-200 prose-code:text-blue-800 dark:prose-code:text-blue-300 prose-code:bg-gray-100 dark:prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-gray-50 prose-pre:text-gray-800 dark:prose-pre:bg-zinc-800/80 dark:prose-pre:text-zinc-200 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-zinc-700/50 prose-a:text-blue-800 dark:prose-a:text-blue-400 prose-li:text-gray-900 dark:prose-li:text-zinc-300">
                <Markdown>{block.text}</Markdown>
              </div>
            );
          case 'tool_calls':
            return (
              <div key={`tc-${String(i)}`}>
                {block.calls.map((call) => <ToolCallCard key={call.toolId} call={call} />)}
              </div>
            );
          case 'confirmation': {
            const conf = block.confirmation;
            return (
              <ConfirmationCard
                key={`cf-${String(i)}`}
                confirmation={conf}
                onApprove={() => { if (conf.correlationId) respondToConfirmation(conf.correlationId, true); }}
                onDeny={() => { if (conf.correlationId) respondToConfirmation(conf.correlationId, false); }}
              />
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

interface HistoryToolCall {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'success' | 'error';
}

interface HistoryMessage {
  role: string;
  text: string;
  toolCalls?: HistoryToolCall[];
}

function SessionTitle({ sessionId }: { sessionId: string | null }) {
  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sessionId) { setTitle(null); return; }
    fetch(`/sessions`)
      .then((res) => res.ok ? res.json() : null)
      .then((data: unknown) => {
        if (!data || typeof data !== 'object' || !('sessions' in data)) return;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const sessions = (data as Record<string, unknown>)['sessions'] as Array<{id: string; title?: string; summary: string}>;
        const session = sessions.find((s) => s.id === sessionId);
        if (session) setTitle(session.title ?? session.summary);
      })
      .catch(() => {});
  }, [sessionId]);

  if (!sessionId || !title) return null;

  const save = () => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (!trimmed) return;
    setTitle(trimmed);
    fetch(`/session/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {});
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100 dark:border-zinc-800/50">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="flex-1 text-sm font-medium px-2 py-1 rounded border border-blue-600/50 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-200 outline-none"
          autoFocus
        />
        <button onClick={save} className="text-emerald-500 hover:text-emerald-400">
          <Check className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 px-6 py-2 border-b border-gray-100 dark:border-zinc-800/50">
      <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 truncate">{title}</span>
      <button
        onClick={() => { setEditValue(title); setEditing(true); }}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity"
      >
        <Pencil className="h-3.5 w-3.5 text-gray-500 dark:text-zinc-400" />
      </button>
    </div>
  );
}

export function ChatPage() {
  const { resumeSessionId: serverResumeId } = useRuntimeManifest();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlResumeId = searchParams.get('resume');
  const initialPrompt = searchParams.get('prompt');
  const activeResumeId = useMemo(() => urlResumeId ?? serverResumeId, [urlResumeId, serverResumeId]);

  const location = useLocation();
  const locState: unknown = location.state;
  const newChatKey = typeof locState === 'object' && locState !== null && 'newChat' in locState
    ? (locState as {newChat: unknown}).newChat
    : undefined;

  const { messages, send, stop, isStreaming, activeToolCalls, respondToConfirmation, usage, sessionId, reset } = useAmodalChat({
    initialSessionId: activeResumeId,
  });
  const [input, setInput] = useState('');
  const promptSent = useRef(false);

  // Reset chat state when switching sessions or clicking "New chat"
  const prevResumeRef = useRef(activeResumeId);
  const prevNewChatKeyRef = useRef(newChatKey);
  useEffect(() => {
    const resumeChanged = prevResumeRef.current !== activeResumeId;
    const newChatClicked = prevNewChatKeyRef.current !== newChatKey;
    prevResumeRef.current = activeResumeId;
    prevNewChatKeyRef.current = newChatKey;
    if (resumeChanged || newChatClicked) {
      reset();
    }
  }, [activeResumeId, newChatKey, reset]);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-send initial prompt from query param (e.g., from "Make Content" button)
  useEffect(() => {
    if (initialPrompt && !promptSent.current && !isStreaming) {
      promptSent.current = true;
      // Clear the prompt from URL to avoid re-sending on refresh
      searchParams.delete('prompt');
      setSearchParams(searchParams, { replace: true });
      send(initialPrompt);
    }
  }, [initialPrompt, isStreaming, send, searchParams, setSearchParams]);

  // Load conversation history for resumed sessions
  useEffect(() => {
    if (!activeResumeId) { setHistory([]); return; }
    fetch(`/session/${encodeURIComponent(activeResumeId)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'messages' in data && Array.isArray((data as Record<string, unknown>)['messages'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response shape
          const msgs = (data as Record<string, unknown>)['messages'] as HistoryMessage[];
          setHistory(msgs.filter((m) => m.role === 'user' || m.role === 'assistant'));
        }
      })
      .catch(() => {});
  }, [activeResumeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, history]);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isStreaming) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      send(trimmed);
    },
    [input, isStreaming, send],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed && !isStreaming) {
          setInput('');
          if (inputRef.current) inputRef.current.style.height = 'auto';
          send(trimmed);
        }
      }
    },
    [input, isStreaming, send],
  );

  const hasMessages = messages.length > 0 || history.length > 0;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      <SessionTitle sessionId={activeResumeId ?? sessionId} />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!hasMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" className="mb-5 opacity-30">
              <defs><clipPath id="empty-sq"><rect x="2" y="10" width="17" height="17" rx="3" /></clipPath></defs>
              <rect x="2" y="10" width="17" height="17" rx="3" fill="#1E40AF" />
              <circle cx="22" cy="11" r="10" fill="#60A5FA" fillOpacity="0.85" />
              <circle cx="22" cy="11" r="10" fill="#3B82F6" clipPath="url(#empty-sq)" />
            </svg>
            <h2 className="text-lg font-medium text-gray-400 dark:text-zinc-400 mb-1">What can I help with?</h2>
            <p className="text-sm text-gray-400 dark:text-zinc-600 max-w-sm">Ask me anything. I can search, analyze, and connect to your tools.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {/* Restored history from previous session */}
            {history.map((msg, i) => (
              <div key={`hist-${String(i)}`} className={msg.role === 'user' ? 'mb-6 flex justify-end' : 'mb-6'}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-blue-700/60 text-white/80 text-[14px] leading-relaxed">
                    {msg.text}
                  </div>
                ) : (
                  <div className="text-[14px] text-gray-400 dark:text-zinc-400">
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div>
                        {msg.toolCalls.map((tc) => (
                          <ToolCallCard key={tc.toolId} call={{...tc, status: 'success'}} />
                        ))}
                      </div>
                    )}
                    {msg.text && (
                      <div className="prose dark:prose-invert prose-sm max-w-none prose-headings:text-gray-700 dark:prose-headings:text-zinc-300 prose-p:text-gray-600 dark:prose-p:text-zinc-400 prose-code:text-gray-800 dark:prose-code:text-zinc-200 prose-code:bg-gray-100 dark:prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-a:text-blue-700 dark:prose-a:text-blue-400">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {history.length > 0 && messages.length === 0 && (
              <div className="text-center text-xs text-gray-400 dark:text-zinc-600 mb-4 py-2 border-t border-gray-200 dark:border-zinc-800/50">
                Session resumed
              </div>
            )}
            {/* Live messages */}
            {messages.map((msg) => {
              switch (msg.type) {
                case 'user':
                  return (
                    <div key={msg.id} className="mb-6 flex justify-end">
                      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-blue-700 text-white text-[14px] leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  );
                case 'assistant_text': {
                  // Find the preceding user message for feedback context
                  const msgIndex = messages.indexOf(msg);
                  const prevUser = messages.slice(0, msgIndex).reverse().find((m) => m.type === 'user');
                  const queryText = prevUser && 'text' in prevUser ? String(prevUser.text) : '';
                  const responseText = msg.contentBlocks
                    .filter((b): b is {type: 'text'; text: string} => b.type === 'text')
                    .map((b) => b.text)
                    .join('');
                  const toolNames = msg.contentBlocks
                    .filter((b): b is {type: 'tool_calls'; calls: ToolCallInfo[]} => b.type === 'tool_calls')
                    .flatMap((b) => b.calls.map((c) => c.toolName));
                  return (
                    <div key={msg.id} className="mb-6">
                      <div className="text-[14px] text-gray-900 dark:text-zinc-200">
                        <MessageContent blocks={msg.contentBlocks} respondToConfirmation={respondToConfirmation} />
                      </div>
                      {!isStreaming && (
                        <FeedbackButtons
                          messageId={msg.id}
                          sessionId={sessionId}
                          query={queryText}
                          response={responseText}
                          toolCalls={toolNames.length > 0 ? toolNames : undefined}
                        />
                      )}
                    </div>
                  );
                }
                case 'error':
                  return (
                    <div key={msg.id} className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                      {msg.message}
                    </div>
                  );
                default:
                  return null;
              }
            })}
            {isStreaming && activeToolCalls.length === 0 && (
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-zinc-800/80 bg-gray-50 dark:bg-[#0f0f17] px-4 py-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={isStreaming}
            rows={1}
            className="w-full resize-none rounded-xl bg-white dark:bg-zinc-800/80 border border-gray-300 dark:border-zinc-700/60 px-4 py-3 pr-12 text-[14px] text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 outline-none focus:border-blue-600/60 focus:ring-1 focus:ring-blue-600/20 transition-colors disabled:opacity-50 overflow-y-auto"
            style={{ minHeight: '48px', maxHeight: '160px' }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-gray-500 dark:bg-zinc-600 text-white flex items-center justify-center hover:bg-gray-400 dark:hover:bg-zinc-500 transition-colors"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim().length === 0}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-blue-700 text-white flex items-center justify-center hover:bg-blue-600 transition-colors disabled:opacity-20 disabled:hover:bg-blue-700"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        {(usage.inputTokens > 0 || usage.outputTokens > 0) && (
          <div className="max-w-3xl mx-auto mt-1.5 text-[11px] text-gray-400 dark:text-zinc-600 font-mono text-right">
            {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens ({usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out)
          </div>
        )}
      </div>
    </div>
  );
}
