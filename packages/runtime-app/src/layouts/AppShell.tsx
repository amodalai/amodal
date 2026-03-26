/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Sidebar } from '@/sections/Sidebar';
import { ChatPanel } from './ChatPanel';

/**
 * Main application shell — fixed header + sidebar + content + optional chat panel.
 */
export function AppShell() {
  const [chatOpen, setChatOpen] = useState(false);
  const location = useLocation();
  const isChatPage = location.pathname === '/';

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-zinc-900 text-white flex items-center px-5 shrink-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">A</span>
          </div>
          <span className="font-semibold tracking-tight text-[15px]">Amodal</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-auto bg-gray-50/50 scrollbar-thin">
          <Outlet />
        </main>

        {/* Chat toggle button (only on non-chat pages) */}
        {!isChatPage && !chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 h-11 w-11 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center hover:bg-indigo-700 transition-colors z-10"
            title="Open chat"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        )}

        {/* Chat panel (only on non-chat pages) */}
        {!isChatPage && (
          <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
        )}
      </div>
    </div>
  );
}
