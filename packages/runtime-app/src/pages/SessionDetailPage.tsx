/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import { FormattedMarkdown } from '@amodalai/react';
import { API_PATHS } from '@/lib/api-paths';

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
    fetch(API_PATHS.sessionHistory(sessionId))
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
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/sessions" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-foreground font-mono">{sessionId?.slice(0, 8)}...</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-muted-foreground">{userMessages.length} messages</span>
              <span className="text-xs text-muted-foreground">{assistantMessages.length} responses</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => { void navigate(`/?resume=${sessionId ?? ''}`); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary-solid text-white hover:bg-primary-solid/90 transition-colors"
        >
          <Play className="h-3 w-3" />
          Resume
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-400 text-sm">{error}</div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.map((msg, i) => (
              <div key={`msg-${String(i)}`} className={msg.role === 'user' ? 'mb-6 flex justify-end' : 'mb-6'}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary-solid text-white text-[14px] leading-relaxed">
                    {msg.text}
                  </div>
                ) : (
                  <FormattedMarkdown className="text-[14px] text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-a:text-primary prose-li:text-foreground">
                    {msg.text}
                  </FormattedMarkdown>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
