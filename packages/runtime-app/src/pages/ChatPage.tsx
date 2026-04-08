/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { FormEvent } from 'react';
import { Send, Square, Loader2, Wrench, Pencil, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useSearchParams, useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useAmodalChat, useImagePaste, DEFAULT_IMAGE_PROMPT } from '@amodalai/react';
import type { ToolCallInfo, ContentBlock, ConfirmationInfo } from '@amodalai/react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { ToolCallCard } from '@/components/ToolCallCard';

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
        // eslint-disable-next-line no-console -- fire-and-forget: log for debugging
    }).catch((err: unknown) => { console.warn('[feedback] submit failed:', err); });
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
          className={`p-1 rounded transition-colors ${rating === 'up' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-300 dark:text-zinc-600 hover:text-emerald-400 hover:bg-muted'}`}
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
          className={`p-1 rounded transition-colors ${rating === 'down' ? 'text-red-400 bg-red-500/10' : 'text-gray-300 dark:text-zinc-600 hover:text-red-400 hover:bg-muted'}`}
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
            className="flex-1 text-xs px-2 py-1.5 rounded border border-border bg-muted text-foreground placeholder:text-muted-foreground"
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

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  if (elapsed < 1) return null;
  return <span className="text-muted-foreground font-mono tabular-nums text-xs">{elapsed}s</span>;
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
        <span className="uppercase text-[11px] font-bold bg-primary-solid text-white px-1.5 py-0.5 rounded">
          {confirmation.method}
        </span>
        <span className="text-muted-foreground">{confirmation.endpoint}</span>
      </div>
      {confirmation.reason && (
        <p className="text-xs text-muted-foreground mb-2">{confirmation.reason}</p>
      )}
      {!resolved ? (
        <div className="flex gap-2">
          <button onClick={onApprove} className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
            Approve
          </button>
          <button onClick={onDeny} className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground border border-border hover:bg-muted/80 transition-colors">
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
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
        switch (block.type) {
          case 'text':
            return (
              <div key={`t-${String(i)}`} className="text-foreground prose dark:prose-invert max-w-none text-[15px] leading-relaxed prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:border-border prose-a:text-primary">
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
      // eslint-disable-next-line no-console -- fire-and-forget: log for debugging
      .catch((err: unknown) => { console.warn('[session] title fetch failed:', err); });
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
    // eslint-disable-next-line no-console -- fire-and-forget: log for debugging
    }).catch((err: unknown) => { console.warn('[session] title save failed:', err); });
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="flex-1 text-sm font-medium px-2 py-1 rounded border border-primary/50 bg-background text-foreground outline-none"
          autoFocus
        />
        <button onClick={save} className="text-emerald-500 hover:text-emerald-400">
          <Check className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 px-6 py-2 border-b border-border">
      <span className="text-sm font-medium text-foreground truncate">{title}</span>
      <button
        onClick={() => { setEditValue(title); setEditing(true); }}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity"
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
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
  const [streamStartTime, setStreamStartTime] = useState(0);

  // Track when streaming starts/stops
  useEffect(() => {
    if (isStreaming && streamStartTime === 0) {
      setStreamStartTime(Date.now());
    } else if (!isStreaming && streamStartTime > 0) {
      setStreamStartTime(0);
    }
  }, [isStreaming, streamStartTime]);

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
  const [imageError, setImageError] = useState<string | null>(null);
  const { images: pastedImages, handlePaste, removeImage: removePastedImage, clearImages } = useImagePaste({
    onReject: (reason) => {
      setImageError(reason);
      setTimeout(() => setImageError(null), 3000);
    },
  });

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
      // eslint-disable-next-line no-console -- fire-and-forget: log for debugging
      .catch((err: unknown) => { console.warn('[session] history fetch failed:', err); });
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
      if ((!trimmed && pastedImages.length === 0) || isStreaming) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      send(trimmed || DEFAULT_IMAGE_PROMPT, pastedImages.length > 0 ? pastedImages : undefined);
      clearImages();
    },
    [input, isStreaming, send, pastedImages, clearImages],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if ((trimmed || pastedImages.length > 0) && !isStreaming) {
          setInput('');
          if (inputRef.current) inputRef.current.style.height = 'auto';
          send(trimmed || DEFAULT_IMAGE_PROMPT, pastedImages.length > 0 ? pastedImages : undefined);
          clearImages();
        }
      }
    },
    [input, isStreaming, send, pastedImages, clearImages],
  );

  const hasMessages = messages.length > 0 || history.length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
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
            <h2 className="text-lg font-medium text-gray-400 dark:text-muted-foreground mb-1">What can I help with?</h2>
            <p className="text-sm text-muted-foreground max-w-sm">Ask me anything. I can search, analyze, and connect to your tools.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {/* Restored history from previous session */}
            {history.map((msg, i) => (
              <div key={`hist-${String(i)}`} className={msg.role === 'user' ? 'mb-6 flex justify-end' : 'mb-6'}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary-solid/80 text-white text-[14px] leading-relaxed">
                    {msg.text}
                  </div>
                ) : (
                  <div className="text-[14px] text-gray-400 dark:text-muted-foreground">
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div>
                        {msg.toolCalls.map((tc) => (
                          <ToolCallCard key={tc.toolId} call={{...tc, status: 'success'}} />
                        ))}
                      </div>
                    )}
                    {msg.text && (
                      <div className="prose dark:prose-invert max-w-none text-[14px] leading-relaxed prose-p:text-muted-foreground prose-headings:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-a:text-primary">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {history.length > 0 && messages.length === 0 && (
              <div className="text-center text-xs text-muted-foreground mb-4 py-2 border-t border-border">
                Session resumed
              </div>
            )}
            {/* Live messages */}
            {messages.map((msg) => {
              switch (msg.type) {
                case 'user':
                  return (
                    <div key={msg.id} className="mb-6 flex justify-end">
                      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary-solid text-white text-[14px] leading-relaxed">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap mb-2">
                            {msg.images.map((src, i) => (
                              <img key={i} src={src} alt="Attachment" className="max-w-[200px] max-h-[200px] rounded-lg object-contain" />
                            ))}
                          </div>
                        )}
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
                      <div className="text-[14px] text-foreground">
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
            {isStreaming && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>{activeToolCalls.length > 0 ? 'Working...' : 'Thinking...'}</span>
                <ElapsedTimer startTime={streamStartTime} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border/80 bg-card px-4 py-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          {imageError && (
            <div className="px-3 pt-2 text-xs text-red-400">{imageError}</div>
          )}
          {pastedImages.length > 0 && (
            <div className="flex gap-2 px-3 pt-3 pb-1 flex-wrap">
              {pastedImages.map((img, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                  <img src={img.preview} alt="Attachment" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePastedImage(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-xs hover:bg-black/80"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message..."
            disabled={isStreaming}
            rows={1}
            className="w-full resize-none rounded-xl bg-background border border-border px-4 py-3 pr-12 text-[14px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-colors disabled:opacity-50 overflow-y-auto"
            style={{ minHeight: '48px', maxHeight: '160px' }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-muted-foreground text-white flex items-center justify-center hover:bg-muted-foreground/80 transition-colors"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim().length === 0}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-primary-solid text-white flex items-center justify-center hover:bg-primary-solid/90 transition-colors disabled:opacity-20"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        {(usage.inputTokens > 0 || usage.outputTokens > 0) && (
          <div className="max-w-3xl mx-auto mt-1.5 text-[11px] text-muted-foreground font-mono text-right">
            {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens ({usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out)
          </div>
        )}
      </div>
    </div>
  );
}
