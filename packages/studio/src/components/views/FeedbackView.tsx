/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import { useStudioEvents } from '@/contexts/StudioEventsContext';
import { ThumbsUp, ThumbsDown, CheckCircle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedbackEntry {
  id: string;
  rating: string;
  query: string;
  response: string;
  comment: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
}

interface FeedbackSummary {
  up: number;
  down: number;
  total: number;
}

interface Props {
  initialEntries: FeedbackEntry[];
  initialSummary: FeedbackSummary;
  agentId: string;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARK_REVIEWED_ENDPOINT = '/api/feedback/mark-reviewed';
const QUERY_PREVIEW_LENGTH = 120;
const RESPONSE_PREVIEW_LENGTH = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedbackView({ initialEntries, initialSummary, agentId, onRefresh }: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [summary, _setSummary] = useState(initialSummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to real-time feedback events
  useStudioEvents(['feedback_created'], () => {
    // Refresh to pick up new entries from the server
    onRefresh?.();
  });

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllUnreviewed = useCallback(() => {
    const unreviewedIds = entries.filter((e) => !e.reviewedAt).map((e) => e.id);
    setSelected(new Set(unreviewedIds));
  }, [entries]);

  const handleMarkReviewed = useCallback(async () => {
    if (selected.size === 0) return;

    setMarking(true);
    setError(null);

    try {
      const res = await fetch(MARK_REVIEWED_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });

      if (!res.ok) {
        // System boundary cast — parsing API error response
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const data = (await res.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `Request failed with status ${res.status}`);
      }

      // Update local state optimistically
      const now = new Date().toISOString();
      setEntries((prev) =>
        prev.map((e) => (selected.has(e.id) ? { ...e, reviewedAt: now } : e)),
      );
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMarking(false);
    }
  }, [selected]);

  // Suppress unused variable warning — agentId is passed for future use
  void agentId;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <ThumbsUp className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Positive</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">{summary.up}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <ThumbsDown className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Negative</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">{summary.down}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">Total</span>
          <p className="mt-1 text-lg font-semibold text-foreground">{summary.total}</p>
        </div>
      </div>

      {/* Actions */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={selectAllUnreviewed}
            className="text-xs text-primary hover:underline"
          >
            Select all unreviewed
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => void handleMarkReviewed()}
              disabled={marking}
              className="flex items-center gap-1.5 rounded-md bg-primary-solid px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {marking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              Mark {selected.size} reviewed
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Entry list */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No feedback entries yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-lg border bg-card px-4 py-3 transition-colors ${
                selected.has(entry.id)
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelect(entry.id)}
                  className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary"
                />

                {/* Rating icon */}
                <div className="mt-0.5">
                  {entry.rating === 'up' ? (
                    <ThumbsUp className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ThumbsDown className="h-4 w-4 text-red-500" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(entry.createdAt)}
                    </span>
                    {entry.reviewedAt && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle className="h-3 w-3" />
                        Reviewed
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-foreground">
                    <span className="font-medium">Q: </span>
                    {truncate(entry.query, QUERY_PREVIEW_LENGTH)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="font-medium">A: </span>
                    {truncate(entry.response, RESPONSE_PREVIEW_LENGTH)}
                  </p>

                  {entry.comment && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
                      &ldquo;{entry.comment}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
