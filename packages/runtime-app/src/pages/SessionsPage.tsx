/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Clock, ChevronRight } from 'lucide-react';
import { createLogger } from '@/utils/log';
import { API_PATHS } from '@/lib/api-paths';

const log = createLogger('SessionsPage');

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
    fetch(API_PATHS.SESSIONS_HISTORY)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const items = data as Array<Record<string, unknown>>;
          setSessions(items.map((item) => ({
            id: String(item['id'] ?? ''),
            appId: String(item['app_id'] ?? ''),
            createdAt: item['created_at'] ? new Date(String(item['created_at'])).getTime() : 0,
            lastAccessedAt: item['updated_at'] ? new Date(String(item['updated_at'])).getTime() : 0,
          })));
        }
      })
      .catch((err: unknown) => {
        log.warn('fetch_sessions_failed', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Sessions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No sessions yet. Start a conversation from the Chat page.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-muted transition-colors group"
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate font-mono">
                      {session.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">{session.appId}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatTime(session.createdAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Last active {formatRelative(session.lastAccessedAt)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
