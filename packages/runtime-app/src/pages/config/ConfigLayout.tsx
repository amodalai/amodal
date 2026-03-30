/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { NavLink, Outlet } from 'react-router-dom';
import { Bot, Cpu, KeyRound, FileText, Server, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  return (
    <div className="h-full flex bg-white dark:bg-[#0a0a0f]">
      <aside className="w-[200px] border-r border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17] flex flex-col shrink-0 p-3">
        <NavLink to="/" className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 mb-4 transition-colors">
          <ArrowLeft className="h-3 w-3" />
          Back to app
        </NavLink>

        <div className="text-[10px] font-semibold text-gray-400 dark:text-white/25 uppercase tracking-widest mb-2 px-3">
          Configuration
        </div>

        <nav className="space-y-0.5">
          <ConfigNavItem to="/config" end>
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
          <ConfigNavItem to="/config/system">
            <Server className="h-4 w-4 shrink-0" />
            System
          </ConfigNavItem>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
