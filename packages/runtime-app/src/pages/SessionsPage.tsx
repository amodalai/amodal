/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Clock, ChevronRight } from 'lucide-react';

interface SessionSummary {
  id: string;
  appId: string;
  createdAt: number;
  lastAccessedAt: number;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/sessions')
      .then((res) => (res.ok ? res.json() : { sessions: [] }))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'sessions' in data && Array.isArray((data as Record<string, unknown>)['sessions'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setSessions((data as Record<string, unknown>)['sessions'] as SessionSummary[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="border-b border-zinc-800/50 px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-200">Sessions</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <MessageSquare className="h-8 w-8 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">No sessions yet. Start a conversation from the Chat page.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors group"
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-300 truncate font-mono">
                      {session.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-zinc-600">{session.appId}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      <Clock className="h-3 w-3" />
                      {formatTime(session.createdAt)}
                    </span>
                    <span className="text-xs text-zinc-600">
                      Last active {formatRelative(session.lastAccessedAt)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-500 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
