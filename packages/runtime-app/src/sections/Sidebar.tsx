/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { SquarePen, MessageSquare, FileText, Pencil, Trash2, ExternalLink, Sun, Moon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRuntimeEvents } from '@/contexts/RuntimeEventsContext';
import { cn } from '@/lib/utils';
import { useSessions, useRenameSession, useDeleteSession } from '@/hooks/useSessions';
import { usePages, useRuntimeContext } from '@/hooks/useRuntimeData';

const RUNTIME_URL = window.location.origin;
const EVAL_APP_IDS = new Set(['eval-runner', 'eval-judge', 'admin']);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DeleteConfirmModal({ sessionName, onConfirm, onCancel }: { sessionName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-card rounded-xl border border-border p-5 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground mb-2">Delete session?</h3>
        <p className="text-xs text-muted-foreground mb-4">
          &ldquo;{sessionName}&rdquo; will be permanently deleted.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted transition-colors">
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

function SessionItem({ session, isActive, onNavigate, onDelete, onRename }: {
  session: { id: string; title?: string; summary: string };
  isActive: boolean;
  onNavigate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
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
    onRename(session.id, trimmed);
  }, [editValue, session, onRename]);

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
          className="w-full text-[12px] px-1.5 py-0.5 rounded border border-primary/50 bg-card text-foreground outline-none"
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
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{children}</span>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function Sidebar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Data hooks
  const { data: allSessions } = useSessions();
  const { data: pages } = usePages();
  const { data: runtimeCtx } = useRuntimeContext(RUNTIME_URL);

  const renameMutation = useRenameSession();
  const deleteMutation = useDeleteSession();

  // Filter sessions for sidebar display
  const sessions = useMemo(
    () => allSessions.filter((s) => !EVAL_APP_IDS.has(s.appId)).slice(0, 10),
    [allSessions],
  );

  const studioUrl = runtimeCtx?.studioUrl ?? null;

  // Refetch sessions on runtime events
  useRuntimeEvents(['session_created', 'session_updated', 'session_deleted'], () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
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
                <NavLink to="/sessions" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
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
                  onRename={(id, title) => { renameMutation.mutate({ sessionId: id, title }); }}
                  onDelete={(id) => {
                    deleteMutation.mutate(id);
                    if (location.search.includes(id)) { void navigate('/'); }
                  }}
                />
              ))}
            </div>
          </>
        )}

        {pages.length > 0 && (
          <>
            <SectionLabel>Pages</SectionLabel>
            <div className="space-y-0.5">
              {pages.map((page) => (
                <NavItem key={page.name} to={`/pages/${page.name}`}>
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{formatPageName(page.name)}</span>
                </NavItem>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="px-4 py-3 flex items-center justify-between">
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        {studioUrl && (
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </aside>
  );
}

function formatPageName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
