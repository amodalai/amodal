/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import Markdown from 'react-markdown';

interface HistoryMessage {
  role: string;
  text: string;
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/session/${encodeURIComponent(sessionId)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Session not found');
        return res.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'messages' in data && Array.isArray((data as Record<string, unknown>)['messages'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setMessages((data as Record<string, unknown>)['messages'] as HistoryMessage[]);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-zinc-800/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/sessions" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-zinc-200 font-mono">{sessionId?.slice(0, 8)}...</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-zinc-500">{userMessages.length} messages</span>
              <span className="text-xs text-zinc-500">{assistantMessages.length} responses</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => { void navigate(`/?resume=${sessionId ?? ''}`); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-white hover:bg-primary transition-colors"
        >
          <Play className="h-3 w-3" />
          Resume
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-400 text-sm">{error}</div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.map((msg, i) => (
              <div key={`msg-${String(i)}`} className={msg.role === 'user' ? 'mb-6 flex justify-end' : 'mb-6'}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary/70 text-white text-[14px] leading-relaxed">
                    {msg.text}
                  </div>
                ) : (
                  <div className="text-[14px] text-zinc-300 prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-p:text-zinc-300 prose-strong:text-zinc-200 prose-code:text-primary prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-zinc-800/80 prose-pre:border prose-pre:border-zinc-700/50 prose-a:text-primary prose-li:text-zinc-300">
                    <Markdown>{msg.text}</Markdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
