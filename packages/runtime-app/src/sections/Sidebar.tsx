/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { MessageSquare, Database, Zap, FileText } from 'lucide-react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { cn } from '@/lib/utils';
import type { PageConfig } from 'virtual:amodal-manifest';

function NavItem({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors duration-150',
          isActive
            ? 'bg-indigo-50 text-indigo-600 font-medium'
            : 'text-gray-600 hover:text-indigo-600 hover:bg-gray-50',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-5 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
      {children}
    </div>
  );
}

export function Sidebar() {
  const { stores } = useRuntimeManifest();
  const [devPages, setDevPages] = useState<PageConfig[]>([]);

  useEffect(() => {
    import('virtual:amodal-manifest')
      .then((m) => {
        setDevPages(m.pages.filter((p: PageConfig) => !p.hidden));
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-[250px] border-r border-gray-200 bg-white flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        {/* Chat */}
        <NavItem to="/" end>
          <MessageSquare className="h-4 w-4 shrink-0" />
          Chat
        </NavItem>

        {/* Pages (developer-written) */}
        {devPages.length > 0 && (
          <>
            <SectionLabel>Pages</SectionLabel>
            <div className="space-y-0.5">
              {devPages.map((page) => (
                <NavItem key={page.name} to={`/pages/${page.name}`}>
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate" title={page.description}>
                    {formatPageName(page.name)}
                  </span>
                </NavItem>
              ))}
            </div>
          </>
        )}

        {/* Entities */}
        {stores.length > 0 && (
          <>
            <SectionLabel>Entities</SectionLabel>
            <div className="space-y-0.5">
              {stores.map((store) => (
                <NavItem key={store.name} to={`/entities/${store.name}`}>
                  <Database className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="flex-1 truncate">{store.entity.name}</span>
                  {store.documentCount > 0 && (
                    <span className="text-[11px] text-gray-400 tabular-nums bg-gray-100 px-1.5 py-0.5 rounded-full">
                      {store.documentCount.toLocaleString()}
                    </span>
                  )}
                </NavItem>
              ))}
            </div>
          </>
        )}

        {/* Automations */}
        <SectionLabel>Automations</SectionLabel>
        <NavItem to="/automations">
          <Zap className="h-4 w-4 shrink-0 text-gray-400" />
          Automations
        </NavItem>
      </nav>
    </aside>
  );
}

function formatPageName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
