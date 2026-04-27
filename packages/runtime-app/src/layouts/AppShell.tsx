/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { Sidebar } from '@/sections/Sidebar';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useRuntimeConnection } from '@/contexts/RuntimeEventsContext';

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <header className="h-14 bg-card border-b border-border text-gray-900 dark:text-white flex items-center justify-between px-5 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="#334155" />
            <polygon points="16,3 6,20 16,27" fill="white" />
            <polyline points="16,3 26,20 16,27" fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="miter" />
            <line x1="16" y1="3" x2="16" y2="27" stroke="white" strokeWidth="1.2" />
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
