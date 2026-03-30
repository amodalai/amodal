/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { SquarePen, MessageSquare, Database, Zap, FileText, Plug, Sparkles, BookOpen, ChevronRight, Loader2 } from 'lucide-react';
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
            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
            : 'text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white/80 hover:bg-gray-100 dark:hover:bg-white/[0.04]',
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
      <span className="text-[10px] font-semibold text-gray-400 dark:text-white/25 uppercase tracking-widest">{children}</span>
      {action}
    </div>
  );
}

function CollapsibleSection({ label, icon, children, count }: { label: string; icon: React.ReactNode; children: React.ReactNode; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-[7px] rounded-md text-[13px] text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white/80 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <span className="text-[11px] text-gray-400 dark:text-white/25">{String(count)}</span>
      </button>
      {open && <div className="ml-3 space-y-0.5">{children}</div>}
    </div>
  );
}

function InfoItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-[6px] text-[13px] text-gray-400 dark:text-white/40">
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

export function Sidebar() {
  const { stores, connections, skills, automations, knowledge } = useRuntimeManifest();
  const [devPages, setDevPages] = useState<PageConfig[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [runningAutomations, setRunningAutomations] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Try API first (works with pre-built pages), fall back to Vite virtual module
    fetch('/api/pages')
      .then((res) => res.ok ? res.json() : null)
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'pages' in data && Array.isArray((data as Record<string, unknown>)['pages'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const pages = (data as Record<string, unknown>)['pages'] as Array<{name: string}>;
          setDevPages(pages.map((p) => ({name: p.name, filePath: ''} as PageConfig)));
        }
      })
      .catch(() => {
        // Fall back to Vite virtual module (inside monorepo)
        import('virtual:amodal-manifest')
          .then((m) => {
            setDevPages(m.pages.filter((p: PageConfig) => !p.hidden));
          })
          .catch(() => {});
      });
  }, []);

  // Poll automation running state every 3 seconds
  useEffect(() => {
    const poll = () => {
      fetch('/automations')
        .then((res) => (res.ok ? res.json() : { automations: [] }))
        .then((data: unknown) => {
          if (data && typeof data === 'object' && 'automations' in data) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
            const autos = (data as Record<string, unknown>)['automations'] as Array<{name: string; lastRun?: string; lastRunStatus?: string}>;
            // Consider "running" if lastRun was in the last 5 seconds (rough heuristic since we don't track in-flight)
            const running = new Set(autos.filter((a) => a.lastRun && (Date.now() - new Date(a.lastRun).getTime()) < 5000).map((a) => a.name));
            setRunningAutomations(running);
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch('/sessions')
      .then((res) => (res.ok ? res.json() : { sessions: [] }))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'sessions' in data && Array.isArray((data as Record<string, unknown>)['sessions'])) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const all = (data as Record<string, unknown>)['sessions'] as Array<SessionSummary & {automationName?: string}>;
          // Filter out automation sessions — those show in the automation detail page
          setSessions(all.filter((s) => !s.automationName).slice(0, 10));
        }
      })
      .catch(() => {});
  }, [location.pathname]);

  return (
    <aside className="w-[260px] border-r border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17] flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        <button
          onClick={() => { void navigate('/'); }}
          className="flex items-center gap-2.5 w-full px-3 py-2 mb-1 rounded-md text-[13px] text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white/90 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          New chat
        </button>

        {sessions.length > 0 && (
          <>
            <SectionLabel
              action={
                <NavLink to="/sessions" className="text-[10px] text-gray-400 dark:text-white/20 hover:text-gray-600 dark:hover:text-white/40 transition-colors">
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
                        ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                        : 'text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/[0.03]',
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

        {/* Pages */}
        {devPages.length > 0 && (
          <>
            <SectionLabel>Pages</SectionLabel>
            <div className="space-y-0.5">
              {devPages.map((page) => (
                <NavItem key={page.name} to={`/pages/${page.name}`}>
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{formatPageName(page.name)}</span>
                </NavItem>
              ))}
            </div>
          </>
        )}

        {/* Automations */}
        {automations.length > 0 && (
          <>
            <SectionLabel>Automations</SectionLabel>
            {automations.map((name) => (
              <NavItem key={name} to={`/automations/${encodeURIComponent(name)}`}>
                {runningAutomations.has(name) ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 text-purple-400 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5 shrink-0 text-purple-500/60" />
                )}
                <span className="truncate">{name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
              </NavItem>
            ))}
          </>
        )}

        {/* Agent composition — collapsible */}
        {(connections.length > 0 || skills.length > 0 || knowledge.length > 0) && (
          <SectionLabel>Agent</SectionLabel>
        )}

        {connections.length > 0 && (
          <CollapsibleSection label="Connections" icon={<Plug className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" />} count={connections.length}>
            {connections.map((name) => (
              <InfoItem key={name} icon={<Plug className="h-3 w-3 shrink-0 text-emerald-500/40" />} label={name} />
            ))}
          </CollapsibleSection>
        )}

        {skills.length > 0 && (
          <CollapsibleSection label="Skills" icon={<Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500/60" />} count={skills.length}>
            {skills.map((name) => (
              <InfoItem key={name} icon={<Sparkles className="h-3 w-3 shrink-0 text-amber-500/40" />} label={name} />
            ))}
          </CollapsibleSection>
        )}

        {knowledge.length > 0 && (
          <CollapsibleSection label="Knowledge" icon={<BookOpen className="h-3.5 w-3.5 shrink-0 text-blue-500/60" />} count={knowledge.length}>
            {knowledge.map((name) => (
              <InfoItem key={name} icon={<BookOpen className="h-3 w-3 shrink-0 text-blue-500/40" />} label={name} />
            ))}
          </CollapsibleSection>
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
                    <span className="text-[11px] text-gray-400 dark:text-white/30 tabular-nums bg-gray-200 dark:bg-white/[0.06] px-1.5 py-0.5 rounded-full">
                      {store.documentCount.toLocaleString()}
                    </span>
                  )}
                </NavItem>
              ))}
            </div>
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
