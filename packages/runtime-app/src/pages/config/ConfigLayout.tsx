/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { Sun, Moon, Settings, Bot, KeyRound, FileText, ArrowLeft, FolderCode, MessageSquare, PanelRightOpen, PanelRightClose, FlaskConical, Swords } from 'lucide-react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useRuntimeConnection } from '@/contexts/RuntimeEventsContext';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useMe, hasRole } from '@/hooks/useMe';
import { WorkspaceBar } from '@/components/WorkspaceBar';
import { AdminChatPanel } from './ConfigChatPage';
import { cn } from '@/lib/utils';
import { createLogger } from '@/utils/log';

const log = createLogger('ConfigLayout');

type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

function useConnectionStatus(): ConnectionStatus {
  // SSE event bus connection is the liveness signal — no polling needed.
  const connected = useRuntimeConnection();
  const [hasEverConnected, setHasEverConnected] = useState(false);

  useEffect(() => {
    if (connected) setHasEverConnected(true);
  }, [connected]);

  if (connected) return 'connected';
  return hasEverConnected ? 'disconnected' : 'checking';
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('amodal-theme', next ? 'dark' : 'light'); } catch { /* */ }
  }, [dark]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('amodal-theme');
      if (saved === 'light') {
        setDark(false);
        document.documentElement.classList.remove('dark');
      }
    } catch { /* */ }
  }, []);

  return { dark, toggle };
}

function ConfigNavItem({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
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

export function ConfigLayout() {
  const { name, model } = useRuntimeManifest();
  const { dark, toggle } = useTheme();
  const connectionStatus = useConnectionStatus();
  const [chatOpen, setChatOpen] = useState(false);
  const workspace = useWorkspace();
  const connected = useRuntimeConnection();
  // Config UI is ops-only. Hook called unconditionally; check happens after
  // all hooks below to keep hook order stable across renders.
  const me = useMe();

  // Restore workspace on reconnect if there are pending changes
  useEffect(() => {
    if (connected && workspace?.stored?.bundle) {
      // restore() can throw on stale base or network failure — log it.
      // The isStale flag and bundle warning surface the user-facing state.
      workspace.restore().catch((err: unknown) => {
        log.warn('workspace_restore_on_reconnect_failed', { err });
      });
    }
  // Only restore when connection state changes to connected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // Listen for requests to open the admin chat panel (e.g. from Feedback synthesis)
  useEffect(() => {
    const handler = () => setChatOpen(true);
    window.addEventListener('admin-chat-open', handler);
    return () => window.removeEventListener('admin-chat-open', handler);
  }, []);

  // Role gate: redirect non-ops users to the chat. We render `null` while
  // the role check is pending so non-ops users never see a flash of the
  // config UI before the redirect fires. In `amodal dev` everyone is ops
  // so the role resolves to ops on first paint and the null render is
  // basically invisible. Done after all hooks to keep order stable.
  if (!me.ready) {
    return null;
  }
  if (!hasRole(me.user, 'ops')) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <header className="h-14 bg-card border-b border-border text-gray-900 dark:text-white flex items-center justify-between px-5 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <defs><clipPath id="logo-sq"><rect x="2" y="10" width="17" height="17" rx="3" /></clipPath></defs>
            <rect x="2" y="10" width="17" height="17" rx="3" fill="#1E40AF" />
            <circle cx="22" cy="11" r="10" fill="#60A5FA" fillOpacity="0.85" />
            <circle cx="22" cy="11" r="10" fill="#3B82F6" clipPath="url(#logo-sq)" />
          </svg>
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-[15px] text-foreground">amodal</span>
            {name && (
              <>
                <span className="text-gray-300 dark:text-white/60">/</span>
                <span className="text-[13px] text-muted-foreground font-medium">{name}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NavLink
            to="/config"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-primary dark:text-primary bg-primary/10 transition-colors"
            title="Configuration"
          >
            <Settings className="h-4 w-4" />
          </NavLink>
          <button
            onClick={toggle}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 dark:text-white/50 hover:text-gray-600 dark:hover:text-white/80 hover:bg-muted transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {model && (
            <span className="text-[11px] text-gray-400 dark:text-white/45 font-mono">{model.replace(/-\d{8}$/, '')}</span>
          )}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
              connectionStatus === 'checking' ? 'bg-amber-400 animate-pulse' :
              'bg-red-400'
            }`} />
            <span className="text-[11px] text-gray-400 dark:text-white/60 font-medium tracking-wide uppercase">
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'checking' ? 'Connecting' :
               'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[260px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
            <NavLink
              to="/"
              className="flex items-center gap-2.5 w-full px-3 py-2 mb-1 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to app
            </NavLink>

            <div className="px-3 pt-5 pb-1.5">
              <span className="text-[10px] font-semibold text-gray-400 dark:text-white/45 uppercase tracking-widest">Configuration</span>
            </div>

            <div className="space-y-0.5">
              <ConfigNavItem to="/config" end>
                <Bot className="h-4 w-4 shrink-0" />
                Overview
              </ConfigNavItem>
              <ConfigNavItem to="/config/prompt">
                <FileText className="h-4 w-4 shrink-0" />
                Prompt
              </ConfigNavItem>
              <ConfigNavItem to="/config/secrets">
                <KeyRound className="h-4 w-4 shrink-0" />
                Secrets
              </ConfigNavItem>
              <ConfigNavItem to="/config/files">
                <FolderCode className="h-4 w-4 shrink-0" />
                Files
              </ConfigNavItem>
              <ConfigNavItem to="/config/evals">
                <FlaskConical className="h-4 w-4 shrink-0" />
                Eval Suite
              </ConfigNavItem>
              <ConfigNavItem to="/config/arena">
                <Swords className="h-4 w-4 shrink-0" />
                Model Arena
              </ConfigNavItem>
              <ConfigNavItem to="/config/feedback">
                <MessageSquare className="h-4 w-4 shrink-0" />
                Feedback
              </ConfigNavItem>

              <div className="mt-3 mb-1 px-3 pt-3 border-t border-border">
                <span className="text-[10px] font-semibold text-gray-400 dark:text-white/45 uppercase tracking-widest">Tools</span>
              </div>

              <button
                onClick={() => setChatOpen((v) => !v)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-[7px] rounded-md text-[13px] transition-colors duration-150',
                  chatOpen
                    ? 'bg-primary/10 text-primary dark:text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                Admin Agent
                {chatOpen
                  ? <PanelRightClose className="h-3.5 w-3.5 ml-auto" />
                  : <PanelRightOpen className="h-3.5 w-3.5 ml-auto" />
                }
              </button>
            </div>
          </nav>
        </aside>

        <main className={cn('overflow-auto bg-background scrollbar-thin', chatOpen ? 'w-[60%]' : 'flex-1')}>
          <Outlet />
        </main>

        {chatOpen && (
          <div className="w-[40%] border-l border-border flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
              <span className="text-[11px] font-semibold text-gray-400 dark:text-white/45 uppercase tracking-widest">Admin Agent</span>
              <button
                onClick={() => setChatOpen(false)}
                className="text-gray-400 dark:text-white/50 hover:text-gray-600 dark:hover:text-white/80"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AdminChatPanel compact />
            </div>
          </div>
        )}
      </div>

      {workspace?.isDirty && (
        <WorkspaceBar workspace={workspace} />
      )}
    </div>
  );
}
