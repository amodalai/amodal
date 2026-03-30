/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MessageSquare, Sun, Moon } from 'lucide-react';
import { Sidebar } from '@/sections/Sidebar';
import { ChatPanel } from './ChatPanel';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('amodal-theme', next ? 'dark' : 'light'); } catch { /* */ }
  }, [dark]);

  // Restore from localStorage on mount
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
  const [chatOpen, setChatOpen] = useState(false);
  const location = useLocation();
  const isChatPage = location.pathname === '/';
  const { name, model } = useRuntimeManifest();
  const { dark, toggle } = useTheme();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white dark:bg-[#0a0a0f]">
      <header className="h-14 bg-gray-50 dark:bg-[#0f0f17] border-b border-gray-200 dark:border-white/[0.06] text-gray-900 dark:text-white flex items-center justify-between px-5 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <defs><clipPath id="logo-sq"><rect x="2" y="10" width="17" height="17" rx="3" /></clipPath></defs>
            <rect x="2" y="10" width="17" height="17" rx="3" fill="#1E40AF" />
            <circle cx="22" cy="11" r="10" fill="#60A5FA" fillOpacity="0.85" />
            <circle cx="22" cy="11" r="10" fill="#3B82F6" clipPath="url(#logo-sq)" />
          </svg>
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-[15px] text-gray-900 dark:text-white/90">amodal</span>
            {name && (
              <>
                <span className="text-gray-300 dark:text-white/20">/</span>
                <span className="text-[13px] text-gray-500 dark:text-white/50 font-medium">{name}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {model && (
            <span className="text-[11px] text-gray-400 dark:text-white/25 font-mono">{model.replace(/-\d{8}$/, '')}</span>
          )}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-gray-400 dark:text-white/40 font-medium tracking-wide uppercase">Connected</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-white dark:bg-[#0a0a0f] scrollbar-thin">
          <Outlet />
        </main>
        {!isChatPage && !chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 h-12 w-12 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 flex items-center justify-center hover:bg-indigo-500 transition-colors z-10"
            title="Open chat"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        )}
        {!isChatPage && (
          <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
        )}
      </div>
    </div>
  );
}
