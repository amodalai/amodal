/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { SquarePen, MessageSquare, FileText, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { useRuntimeEvents } from '@/contexts/RuntimeEventsContext';
import { cn } from '@/lib/utils';
import { createLogger } from '@/utils/log';
import type { PageConfig } from 'virtual:amodal-manifest';

const log = createLogger('Sidebar');

/** Timeout for the /api/context fetch used to discover the Studio URL. */
const CONTEXT_FETCH_TIMEOUT_MS = 5_000;
const CONTEXT_ENDPOINT = '/api/context' as const;

interface SessionSummary {
  id: string;
  appId: string;
  title?: string;
  summary: string;
  lastAccessedAt: number;
}

function toSessionSummary(item: Record<string, unknown>): SessionSummary {
  return {
    id: String(item['id'] ?? ''),
    appId: String(item['app_id'] ?? item['appId'] ?? ''),
    title: typeof item['title'] === 'string' ? item['title'] : undefined,
    summary: String(item['title'] ?? 'Untitled'),
    lastAccessedAt: item['updated_at'] ? new Date(String(item['updated_at'])).getTime() : (typeof item['lastAccessedAt'] === 'number' ? item['lastAccessedAt'] : 0),
  };
}

function DeleteConfirmModal({ sessionName, onConfirm, onCancel }: { sessionName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-5 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground mb-2">Delete session?</h3>
        <p className="text-xs text-muted-foreground mb-4">
          &ldquo;{sessionName}&rdquo; will be permanently deleted.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionItem({ session, isActive, onNavigate, onDelete }: { session: SessionSummary; isActive: boolean; onNavigate: (id: string) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title ?? session.summary);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.title, session.summary]);

  const saveTitle = useCallback(() => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (!trimmed || trimmed === session.summary) return;
    fetch(`/sessions/history/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {});
    session.title = trimmed;
    session.summary = trimmed;
  }, [editValue, session]);

  if (editing) {
    return (
      <div className="px-3 py-[5px]">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveTitle();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full text-[12px] px-1.5 py-0.5 rounded border border-primary/50 bg-white dark:bg-zinc-800 text-foreground outline-none"
          autoFocus
        />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => onNavigate(session.id)}
        className={cn(
          'group flex items-center gap-2 w-full px-3 py-[6px] rounded-md text-[12px] text-left transition-colors duration-150 truncate',
          isActive
            ? 'bg-primary/10 text-primary dark:text-primary'
            : 'text-gray-400 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/90 hover:bg-muted',
        )}
      >
        <MessageSquare className="h-3 w-3 shrink-0 opacity-40" />
        <span className="truncate flex-1">{session.summary}</span>
        <Pencil
          className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity"
          onClick={startEdit}
        />
        <Trash2
          className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-80 text-red-400 transition-opacity"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        />
      </button>
      {confirmDelete && (
        <DeleteConfirmModal
          sessionName={session.summary}
          onConfirm={() => { setConfirmDelete(false); onDelete(session.id); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors duration-150',
          isActive
            ? 'bg-primary/10 text-primary dark:text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-3 pt-5 pb-1.5 flex items-center justify-between">
      <span className="text-[10px] font-semibold text-gray-400 dark:text-white/45 uppercase tracking-widest">{children}</span>
      {action}
    </div>
  );
}

export function Sidebar() {
  const [devPages, setDevPages] = useState<PageConfig[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch Studio URL from /api/context
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONTEXT_FETCH_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await fetch(CONTEXT_ENDPOINT, { signal: controller.signal });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (typeof body === 'object' && body !== null && 'studioUrl' in body) {
          const url: unknown = (body as Record<string, unknown>)['studioUrl'];
          if (typeof url === 'string') {
            setStudioUrl(url);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        log.warn('context_fetch_error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    // Try API first (works with pre-built pages), fall back to Vite virtual module
    fetch('/api/pages')
      .then((res) => res.ok ? res.json() : null)
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'pages' in data && Array.isArray((data as Record<string, unknown>)['pages'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const pages = (data as Record<string, unknown>)['pages'] as Array<{name: string}>;
          setDevPages(pages.map((p) => ({name: p.name, filePath: ''} as PageConfig)));
        }
      })
      .catch(() => {
        // Fall back to Vite virtual module (inside monorepo)
        import('virtual:amodal-manifest')
          .then((m) => {
            setDevPages(m.pages.filter((p: PageConfig) => !p.hidden));
          })
          .catch(() => {});
      });
  }, []);

  // Fetch session list (initial + refresh on bus events)
  const fetchSessions = useCallback(() => {
    fetch('/sessions/history')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const items = (data as Array<Record<string, unknown>>).map(toSessionSummary);
          const EVAL_APP_IDS = new Set(['eval-runner', 'eval-judge', 'admin']);
          setSessions(items.filter((s) => !EVAL_APP_IDS.has(s.appId)).slice(0, 10));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  useRuntimeEvents(['session_created', 'session_updated', 'session_deleted'], () => {
    fetchSessions();
  });

  return (
    <aside className="w-[260px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        <button
          onClick={() => { void navigate('/', { state: { newChat: Date.now() } }); }}
          className="flex items-center gap-2.5 w-full px-3 py-2 mb-1 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          New chat
        </button>

        {sessions.length > 0 && (
          <>
            <SectionLabel
              action={
                <NavLink to="/sessions" className="text-[10px] text-gray-400 dark:text-white/60 hover:text-gray-600 dark:hover:text-white/80 transition-colors">
                  View all
                </NavLink>
              }
            >
              Recent
            </SectionLabel>
            <div className="space-y-0.5">
              {sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  isActive={location.search.includes(s.id)}
                  onNavigate={(id) => { void navigate(`/?resume=${id}`); }}
                  onDelete={(id) => {
                    fetch(`/sessions/history/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
                    setSessions((prev) => prev.filter((sess) => sess.id !== id));
                    // If we just deleted the active session, go to new chat
                    if (location.search.includes(id)) { void navigate('/'); }
                  }}
                />
              ))}
            </div>
          </>
        )}

        {devPages.length > 0 && (
          <>
            <SectionLabel>Pages</SectionLabel>
            <div className="space-y-0.5">
              {devPages.map((page) => (
                <NavItem key={page.name} to={`/pages/${page.name}`}>
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{formatPageName(page.name)}</span>
                </NavItem>
              ))}
            </div>
          </>
        )}
      </nav>

      {studioUrl && (
        <div className="px-2 py-3">
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className="flex-1">Manage</span>
            <span className="text-[10px] text-gray-400 dark:text-white/45">&rarr;</span>
          </a>
        </div>
      )}
    </aside>
  );
}

function formatPageName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
