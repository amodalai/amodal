/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Sidebar } from '@/sections/Sidebar';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useRuntimeConnection } from '@/contexts/RuntimeEventsContext';
import { useMe, hasRole } from '@/hooks/useMe';

type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

function useConnectionStatus(): ConnectionStatus {
  // The SSE event bus connection is the liveness signal: if the stream
  // is open, the runtime is reachable. No polling needed.
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

export function AppShell() {
  const { name, model } = useRuntimeManifest();
  const { dark, toggle } = useTheme();
  const connectionStatus = useConnectionStatus();
  // Config (Settings gear) is ops-only — admins and users don't see infra config.
  // Gate on `me.ready` AND the role so we don't flash the gear before /api/me
  // resolves to a non-ops role.
  const me = useMe();
  const canSeeConfig = me.ready && hasRole(me.user, 'ops');

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
          {canSeeConfig && (
            <Link
              to="/config"
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Configuration"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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
        <Sidebar />
        <main className="flex-1 overflow-auto bg-background scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
