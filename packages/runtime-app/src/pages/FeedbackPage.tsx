/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeedbackEntry {
  id: string;
  sessionId: string;
  messageId: string;
  rating: 'up' | 'down';
  comment?: string;
  query: string;
  response: string;
  toolCalls?: string[];
  model?: string;
  timestamp: string;
}

interface FeedbackSummary {
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  recentDown: FeedbackEntry[];
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FeedbackPage() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [allEntries, setAllEntries] = useState<FeedbackEntry[]>([]);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/feedback/summary')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        setSummary(data as FeedbackSummary);
      })
      .catch(() => {});

    fetch('/api/feedback?limit=200')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { entries: FeedbackEntry[] };
        setAllEntries(d.entries);
      })
      .catch(() => {});
  }, []);

  const handleSynthesize = async () => {
    setSynthesizing(true);
    setSynthesis(null);

    // Send negative feedback to admin agent for analysis
    const negFeedback = allEntries.filter((e) => e.rating === 'down').slice(0, 20);
    const prompt = `Analyze this user feedback about the agent and recommend specific changes to improve it.

Here are ${String(negFeedback.length)} negative feedback entries:

${negFeedback.map((e, i) => `${String(i + 1)}. Query: "${e.query}"
   Response preview: "${e.response.slice(0, 200)}..."
   ${e.comment ? `User comment: "${e.comment}"` : '(no comment)'}
   ${e.toolCalls?.length ? `Tools used: ${e.toolCalls.join(', ')}` : ''}
   ${e.model ? `Model: ${e.model}` : ''}
`).join('\n')}

Based on these patterns, recommend specific changes:
1. Knowledge docs to add or update
2. Skill modifications
3. Prompt/behavior adjustments
4. Connection or tool improvements

Be specific — reference actual feedback entries and propose concrete file changes.`;

    try {
      const resp = await fetch('/config/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: prompt, app_id: 'feedback-synthesis'}),
      });
      const text = await resp.text();
      let result = '';
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (event['type'] === 'text_delta') {
            result += String(event['content'] ?? '');
          }
        } catch { /* skip */ }
      }
      setSynthesis(result || 'No recommendations generated.');
    } catch {
      setSynthesis('Failed to get recommendations. Is the admin agent available?');
    }
    setSynthesizing(false);
  };

  const positiveRate = summary && summary.total > 0 ? Math.round((summary.thumbsUp / summary.total) * 100) : 0;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">Feedback</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {/* Stats */}
          {summary && (
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-gray-200 dark:border-zinc-800 rounded-lg px-4 py-3">
                <div className="text-2xl font-semibold text-gray-900 dark:text-zinc-200">{summary.total}</div>
                <div className="text-xs text-gray-400 dark:text-zinc-500">Total ratings</div>
              </div>
              <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-2xl font-semibold text-emerald-400">{summary.thumbsUp}</span>
                  {summary.total > 0 && <span className="text-sm text-emerald-400/70">({positiveRate}%)</span>}
                </div>
                <div className="text-xs text-emerald-400/60">Positive</div>
              </div>
              <div className="border border-red-500/20 bg-red-500/5 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <ThumbsDown className="h-4 w-4 text-red-400" />
                  <span className="text-2xl font-semibold text-red-400">{summary.thumbsDown}</span>
                  {summary.total > 0 && <span className="text-sm text-red-400/70">({100 - positiveRate}%)</span>}
                </div>
                <div className="text-xs text-red-400/60">Negative</div>
              </div>
            </div>
          )}

          {/* Synthesize button */}
          <button
            onClick={() => { void handleSynthesize(); }}
            disabled={synthesizing || allEntries.filter((e) => e.rating === 'down').length === 0}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 transition-colors flex items-center gap-2"
          >
            {synthesizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Synthesize Recommendations
          </button>

          {/* Synthesis results */}
          {synthesis && (
            <div className="border border-indigo-500/20 bg-indigo-500/5 rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest mb-2">Admin Agent Recommendations</div>
              <div className="text-sm text-gray-700 dark:text-zinc-300 whitespace-pre-wrap">{synthesis}</div>
            </div>
          )}

          {/* All feedback entries */}
          <div>
            <h2 className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-3">All Feedback</h2>
            <div className="space-y-2">
              {allEntries.length === 0 && (
                <div className="text-sm text-gray-400 dark:text-zinc-500 text-center py-8">
                  No feedback yet. Rate responses in the chat to see data here.
                </div>
              )}
              {allEntries.map((entry) => {
                const isExpanded = expandedEntry === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                    className="w-full text-left border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden"
                  >
                    <div className={cn('flex items-center gap-3 px-4 py-2.5 text-xs',
                      entry.rating === 'down' ? 'bg-red-500/5' : 'bg-emerald-500/5',
                    )}>
                      {entry.rating === 'up' ? (
                        <ThumbsUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <ThumbsDown className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      )}
                      <span className="text-gray-700 dark:text-zinc-300 truncate flex-1">&ldquo;{entry.query}&rdquo;</span>
                      {entry.comment && (
                        <span className="text-red-400/70 truncate max-w-[200px]">{entry.comment}</span>
                      )}
                      {entry.model && (
                        <span className="text-gray-400 dark:text-zinc-600 shrink-0">{entry.model.replace(/-\d{8}$/, '')}</span>
                      )}
                      <span className="text-gray-400 dark:text-zinc-600 shrink-0">{formatRelativeTime(entry.timestamp)}</span>
                    </div>
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800/50 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div>
                          <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-0.5">Query</div>
                          <div className="text-xs text-gray-600 dark:text-zinc-400">{entry.query}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-0.5">Response</div>
                          <div className="text-xs text-gray-600 dark:text-zinc-400 whitespace-pre-wrap">{entry.response}</div>
                        </div>
                        {entry.comment && (
                          <div>
                            <div className="text-[10px] font-semibold text-red-400 uppercase tracking-widest mb-0.5">User Comment</div>
                            <div className="text-xs text-red-300">{entry.comment}</div>
                          </div>
                        )}
                        {entry.toolCalls && entry.toolCalls.length > 0 && (
                          <div className="text-xs text-gray-400 dark:text-zinc-600">
                            Tools: {entry.toolCalls.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
