/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, Sparkles, Archive, CheckSquare, Square, MinusSquare } from 'lucide-react';
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
  reviewedAt?: string;
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

function FeedbackRow({ entry, expanded, onToggleExpand, selected, onToggleSelect }: {
  entry: FeedbackEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div className={cn('border rounded-lg overflow-hidden transition-colors',
      selected ? 'border-primary/30 bg-primary/5' : 'border-border',
    )}>
      <div className={cn('flex items-center gap-2 px-3 py-2 text-xs')}>
        <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} className="shrink-0">
          {selected
            ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
            : <Square className="h-3.5 w-3.5 text-gray-300 dark:text-zinc-600 hover:text-primary transition-colors" />
          }
        </button>
        {entry.rating === 'up'
          ? <ThumbsUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          : <ThumbsDown className="h-3.5 w-3.5 text-red-400 shrink-0" />
        }
        <button onClick={onToggleExpand} className="text-foreground truncate flex-1 text-left hover:text-gray-900 dark:hover:text-zinc-100 transition-colors">
          &ldquo;{entry.query}&rdquo;
        </button>
        {entry.comment && (
          <span className="text-red-400/70 truncate max-w-[200px] shrink-0">{entry.comment}</span>
        )}
        {entry.model && (
          <span className="text-muted-foreground shrink-0">{entry.model.replace(/-\d{8}$/, '')}</span>
        )}
        <span className="text-muted-foreground shrink-0">{formatRelativeTime(entry.timestamp)}</span>
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">Query</div>
            <div className="text-xs text-gray-600 dark:text-zinc-400">{entry.query}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">Response</div>
            <div className="text-xs text-gray-600 dark:text-zinc-400 whitespace-pre-wrap" style={{overflowWrap: 'anywhere'}}>{entry.response}</div>
          </div>
          {entry.comment && (
            <div>
              <div className="text-[10px] font-semibold text-red-400 uppercase tracking-widest mb-0.5">User Comment</div>
              <div className="text-xs text-red-300">{entry.comment}</div>
            </div>
          )}
          {entry.toolCalls && entry.toolCalls.length > 0 && (
            <div className="text-xs text-muted-foreground">Tools: {entry.toolCalls.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function FeedbackPage() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [allEntries, setAllEntries] = useState<FeedbackEntry[]>([]);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadData = () => {
    fetch('/api/feedback/summary')
      .then((res) => res.json())
      .then((data: unknown) => setSummary(data as FeedbackSummary)) // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
      .catch(() => {});
    fetch('/api/feedback?limit=500')
      .then((res) => res.json())
      .then((data: unknown) => {
        const d = data as { entries: FeedbackEntry[] }; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
        setAllEntries(d.entries);
      })
      .catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  const newEntries = allEntries.filter((e) => !e.reviewedAt);
  const reviewedEntries = allEntries.filter((e) => e.reviewedAt);
  const selectedEntries = newEntries.filter((e) => selected.has(e.id));
  const selectedDown = selectedEntries.filter((e) => e.rating === 'down');

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Gmail-style select all toggle
  const allNewSelected = newEntries.length > 0 && newEntries.every((e) => selected.has(e.id));
  const someNewSelected = newEntries.some((e) => selected.has(e.id));
  const toggleSelectAll = () => {
    if (allNewSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newEntries.map((e) => e.id)));
    }
  };

  const selectNegativeOnly = () => setSelected(new Set(newEntries.filter((e) => e.rating === 'down').map((e) => e.id)));

  const markReviewed = (ids: string[]) => {
    fetch('/api/feedback/mark-reviewed', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids}),
    }).then(() => {
      setSelected(new Set());
      loadData();
    }).catch(() => {});
  };

  const handleSynthesize = () => {
    const toSynthesize = selectedDown.slice(0, 15);
    if (toSynthesize.length === 0) return;

    const prompt = `Analyze this user feedback about the agent and recommend specific changes to improve it.

IMPORTANT: Before recommending any new connections, skills, or knowledge docs, use read_repo_file to check amodal_packages/ for installed packages. Never duplicate an installed package.

Here are ${String(toSynthesize.length)} negative feedback entries:

${toSynthesize.map((e, i) => `${String(i + 1)}. Query: "${e.query}"
   Response: "${e.response.slice(0, 300)}${e.response.length > 300 ? '...' : ''}"
   ${e.comment ? `User comment: "${e.comment}"` : '(no comment)'}
   ${e.toolCalls?.length ? `Tools used: ${e.toolCalls.join(', ')}` : ''}
   ${e.model ? `Model: ${e.model}` : ''}
`).join('\n')}

Based on these patterns, recommend specific changes. Check existing config files before suggesting new ones. Present each recommendation and wait for my approval before making any changes.`;

    // Mark all selected as reviewed
    markReviewed([...selected]);

    // Open admin chat and send
    window.dispatchEvent(new CustomEvent('admin-chat-open'));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('admin-chat-send', {detail: prompt}));
    }, 200);
  };

  const positiveRate = summary && summary.total > 0 ? Math.round((summary.thumbsUp / summary.total) * 100) : 0;

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Feedback</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {/* Stats */}
          {summary && (
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-border rounded-lg px-4 py-3">
                <div className="text-2xl font-semibold text-foreground">{summary.total}</div>
                <div className="text-xs text-muted-foreground">Total ratings</div>
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

          {/* New Feedback — inbox style */}
          <div>
            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-2 px-1">
              {/* Select all checkbox */}
              <button onClick={toggleSelectAll} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                {allNewSelected
                  ? <CheckSquare className="h-4 w-4 text-primary" />
                  : someNewSelected
                    ? <MinusSquare className="h-4 w-4 text-primary" />
                    : <Square className="h-4 w-4" />
                }
              </button>

              {/* Quick filters */}
              <div className="flex gap-1.5 text-[10px]">
                <button onClick={selectNegativeOnly} className="text-red-400 hover:text-red-300 transition-colors">negative</button>
              </div>

              <div className="flex-1" />

              {/* Actions */}
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
                  <button
                    onClick={() => markReviewed([...selected])}
                    className="px-2 py-1 rounded text-[11px] text-muted-foreground border border-gray-200 dark:border-zinc-700/50 hover:border-gray-300 dark:hover:border-zinc-600 transition-colors flex items-center gap-1"
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </button>
                  {selectedDown.length > 0 && (
                    <button
                      onClick={handleSynthesize}
                      className="px-2 py-1 rounded bg-primary-solid text-white text-[11px] font-medium hover:bg-primary-solid/90 transition-colors flex items-center gap-1"
                    >
                      <Sparkles className="h-3 w-3" />
                      Synthesize{selectedDown.length > 15 ? ' (15 max)' : ` (${selectedDown.length})`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Entries */}
            <div className="space-y-1">
              {newEntries.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No new feedback. Rate responses in the chat to see data here.
                </div>
              )}
              {newEntries.map((entry) => (
                <FeedbackRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedEntry === entry.id}
                  onToggleExpand={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                  selected={selected.has(entry.id)}
                  onToggleSelect={() => toggleSelect(entry.id)}
                />
              ))}
            </div>
          </div>

          {/* Reviewed */}
          {reviewedEntries.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                Reviewed ({reviewedEntries.length})
              </h2>
              <div className="space-y-1 opacity-40">
                {reviewedEntries.map((entry) => (
                  <FeedbackRow
                    key={entry.id}
                    entry={entry}
                    expanded={expandedEntry === entry.id}
                    onToggleExpand={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                    selected={false}
                    onToggleSelect={() => {}}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
