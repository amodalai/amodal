/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Sun, Moon, Settings, Bot, Cpu, KeyRound, FileText, Server, ArrowLeft, FolderCode, MessageSquare, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { AdminChatPanel } from './ConfigChatPage';
import { cn } from '@/lib/utils';

type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const check = () => {
      fetch('/inspect/health', { signal: AbortSignal.timeout(3000) })
        .then((res) => { setStatus(res.ok ? 'connected' : 'disconnected'); })
        .catch(() => { setStatus('disconnected'); });
    };
    check();
    timer.current = setInterval(check, 10_000);
    return () => clearInterval(timer.current);
  }, []);

  return status;
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
            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
            : 'text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white/80 hover:bg-gray-100 dark:hover:bg-white/[0.04]',
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
  const location = useLocation();
  // Don't show the toggle when already on the chat page
  const isOnChatPage = location.pathname === '/config' || location.pathname === '/config/';

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
          <NavLink
            to="/config"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 transition-colors"
            title="Configuration"
          >
            <Settings className="h-4 w-4" />
          </NavLink>
          {!isOnChatPage && (
            <button
              onClick={() => setChatOpen((v) => !v)}
              className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
                chatOpen
                  ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-500/10'
                  : 'text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              )}
              title={chatOpen ? 'Close admin chat' : 'Open admin chat'}
            >
              {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          )}
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
            <div className={`h-2 w-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
              connectionStatus === 'checking' ? 'bg-amber-400 animate-pulse' :
              'bg-red-400'
            }`} />
            <span className="text-[11px] text-gray-400 dark:text-white/40 font-medium tracking-wide uppercase">
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'checking' ? 'Connecting' :
               'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[260px] border-r border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17] flex flex-col shrink-0 overflow-hidden">
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
            <NavLink
              to="/"
              className="flex items-center gap-2.5 w-full px-3 py-2 mb-1 rounded-md text-[13px] text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white/90 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to app
            </NavLink>

            <div className="px-3 pt-5 pb-1.5">
              <span className="text-[10px] font-semibold text-gray-400 dark:text-white/25 uppercase tracking-widest">Configuration</span>
            </div>

            <div className="space-y-0.5">
              <ConfigNavItem to="/config" end>
                <MessageSquare className="h-4 w-4 shrink-0" />
                Chat
              </ConfigNavItem>
              <ConfigNavItem to="/config/agent">
                <Bot className="h-4 w-4 shrink-0" />
                Agent
              </ConfigNavItem>
              <ConfigNavItem to="/config/models">
                <Cpu className="h-4 w-4 shrink-0" />
                Models
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
              <ConfigNavItem to="/config/system">
                <Server className="h-4 w-4 shrink-0" />
                System
              </ConfigNavItem>
            </div>
          </nav>
        </aside>

        <main className={cn('overflow-auto bg-white dark:bg-[#0a0a0f] scrollbar-thin', chatOpen && !isOnChatPage ? 'w-[60%]' : 'flex-1')}>
          <Outlet />
        </main>

        {chatOpen && !isOnChatPage && (
          <div className="w-[40%] border-l border-gray-200 dark:border-white/[0.06] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17]">
              <span className="text-[11px] font-semibold text-gray-400 dark:text-white/25 uppercase tracking-widest">Admin Chat</span>
              <button
                onClick={() => setChatOpen(false)}
                className="text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60"
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
    </div>
  );
}
