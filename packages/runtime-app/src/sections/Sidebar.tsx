/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { SquarePen, MessageSquare, Database, Zap, FileText, Plug, Sparkles } from 'lucide-react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { cn } from '@/lib/utils';
import type { PageConfig } from 'virtual:amodal-manifest';

interface SessionSummary {
  id: string;
  summary: string;
  lastAccessedAt: number;
}

function NavItem({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors duration-150',
          isActive
            ? 'bg-indigo-500/10 text-indigo-400 font-medium'
            : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]',
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
      <span className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">{children}</span>
      {action}
    </div>
  );
}

function InfoItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-[6px] text-[13px] text-white/40">
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

export function Sidebar() {
  const { stores, connections, skills, automations } = useRuntimeManifest();
  const [devPages, setDevPages] = useState<PageConfig[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    import('virtual:amodal-manifest')
      .then((m) => {
        setDevPages(m.pages.filter((p: PageConfig) => !p.hidden));
      })
      .catch(() => {});
  }, []);

  // Fetch recent sessions
  useEffect(() => {
    fetch('/sessions')
      .then((res) => (res.ok ? res.json() : { sessions: [] }))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'sessions' in data && Array.isArray((data as Record<string, unknown>)['sessions'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const all = (data as Record<string, unknown>)['sessions'] as SessionSummary[];
          setSessions(all.slice(0, 10));
        }
      })
      .catch(() => {});
  }, [location.pathname]); // Refresh when navigating

  return (
    <aside className="w-[260px] border-r border-white/[0.06] bg-[#0f0f17] flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        {/* New chat */}
        <button
          onClick={() => { void navigate('/'); }}
          className="flex items-center gap-2.5 w-full px-3 py-2 mb-1 rounded-md text-[13px] text-white/60 hover:text-white/90 hover:bg-white/[0.04] transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          New chat
        </button>

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <>
            <SectionLabel
              action={
                <NavLink to="/sessions" className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
                  View all
                </NavLink>
              }
            >
              Recent
            </SectionLabel>
            <div className="space-y-0.5">
              {sessions.map((s) => {
                const isActive = location.search.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => { void navigate(`/?resume=${s.id}`); }}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-[6px] rounded-md text-[12px] text-left transition-colors duration-150 truncate',
                      isActive
                        ? 'bg-indigo-500/10 text-indigo-400'
                        : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03]',
                    )}
                  >
                    <MessageSquare className="h-3 w-3 shrink-0 opacity-40" />
                    <span className="truncate">{s.summary}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Connections */}
        {connections.length > 0 && (
          <>
            <SectionLabel>Connections</SectionLabel>
            <div className="space-y-0.5">
              {connections.map((name) => (
                <InfoItem key={name} icon={<Plug className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" />} label={name} />
              ))}
            </div>
          </>
        )}

        {skills.length > 0 && (
          <>
            <SectionLabel>Skills</SectionLabel>
            <div className="space-y-0.5">
              {skills.map((name) => (
                <InfoItem key={name} icon={<Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500/60" />} label={name} />
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
                  <span className="truncate" title={page.description}>
                    {formatPageName(page.name)}
                  </span>
                </NavItem>
              ))}
            </div>
          </>
        )}

        {stores.length > 0 && (
          <>
            <SectionLabel>Entities</SectionLabel>
            <div className="space-y-0.5">
              {stores.map((store) => (
                <NavItem key={store.name} to={`/entities/${store.name}`}>
                  <Database className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{store.entity.name}</span>
                  {store.documentCount > 0 && (
                    <span className="text-[11px] text-white/30 tabular-nums bg-white/[0.06] px-1.5 py-0.5 rounded-full">
                      {store.documentCount.toLocaleString()}
                    </span>
                  )}
                </NavItem>
              ))}
            </div>
          </>
        )}

        {automations.length > 0 && (
          <>
            <SectionLabel>Automations</SectionLabel>
            <NavItem to="/automations">
              <Zap className="h-4 w-4 shrink-0" />
              Automations
              <span className="text-[11px] text-white/30 ml-auto">{String(automations.length)}</span>
            </NavItem>
          </>
        )}
      </nav>
    </aside>
  );
}

function formatPageName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
