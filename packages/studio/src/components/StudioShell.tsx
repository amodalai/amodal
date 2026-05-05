/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { useTheme } from './ThemeProvider';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { AdminChat } from './views/AdminChat';
import {
  ARENA_PATH,
  AUTOMATIONS_PATH,
  CONNECTIONS_PATH,
  COST_PATH,
  EVALS_PATH,
  FEEDBACK_PATH,
  FILES_PATH,
  MEMORY_PATH,
  MODELS_PATH,
  OVERVIEW_PATH,
  PROMPT_PATH,
  SECRETS_PATH,
  SESSIONS_PATH,
  STORES_PATH,
  SYSTEM_PATH,
} from '../lib/routes';
import {
  LayoutDashboard,
  FileCode,
  Database,
  Zap,
  FlaskConical,
  MessageSquare,
  ScrollText,
  KeyRound,
  Cpu,
  Settings,
  Clock,
  Moon,
  Sun,
  ExternalLink,
  Plug,
  PanelRightOpen,
  PanelRightClose,
  Brain,
  DollarSign,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: OVERVIEW_PATH, label: 'Overview', icon: LayoutDashboard },
  { href: SESSIONS_PATH, label: 'Sessions', icon: Clock },
  { href: COST_PATH, label: 'Cost', icon: DollarSign },
  { href: CONNECTIONS_PATH, label: 'Connections', icon: Plug },
  { href: STORES_PATH, label: 'Stores', icon: Database },
  { href: AUTOMATIONS_PATH, label: 'Automations', icon: Zap },
];

const WORKBENCH_NAV: readonly NavItem[] = [
  { href: FILES_PATH, label: 'Files', icon: FileCode },
  { href: EVALS_PATH, label: 'Evals', icon: FlaskConical },
  { href: ARENA_PATH, label: 'Arena', icon: FlaskConical },
  { href: FEEDBACK_PATH, label: 'Feedback', icon: MessageSquare },
  { href: MEMORY_PATH, label: 'Memory', icon: Brain },
];

const CONFIG_NAV: readonly NavItem[] = [
  { href: PROMPT_PATH, label: 'Prompt', icon: ScrollText },
  { href: SECRETS_PATH, label: 'Secrets', icon: KeyRound },
  { href: MODELS_PATH, label: 'Models', icon: Cpu },
  { href: SYSTEM_PATH, label: 'System', icon: Settings },
];

function SidebarNavLink({ item, active, to }: { item: NavItem; active: boolean; to: string }) {
  const Icon = item.icon;
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-sidebar-active text-foreground font-medium shadow-sm ring-1 ring-border/70'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-active/70'
      }`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-foreground' : ''}`} />
      {item.label}
    </Link>
  );
}

export function StudioShell({ children }: Props) {
  const { pathname } = useLocation();
  const { agentId } = useParams();
  const { agentName, runtimeUrl } = useStudioConfig();
  const { dark, toggle } = useTheme();
  const [chatOpen, setChatOpen] = useState(false);

  const basePath = `/agents/${agentId ?? 'local'}`;

  /** Resolve a nav href to an agent-scoped absolute path */
  const agentPath = (href: string) =>
    href === OVERVIEW_PATH ? basePath : `${basePath}/${href}`;

  const isActive = (href: string) => {
    const full = agentPath(href);
    return pathname === full || (href !== OVERVIEW_PATH && pathname.startsWith(full));
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-border bg-sidebar">
        {/* Header */}
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground truncate">{agentName}</h1>
          <a
            href={runtimeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1"
          >
            Open Agent <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          <div className="px-2 space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          <div className="my-3 mx-4 border-t border-border" />

          <div className="px-2 space-y-0.5">
            {WORKBENCH_NAV.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          <div className="my-3 mx-4 border-t border-border" />

          <div className="px-2 space-y-0.5">
            {CONFIG_NAV.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          {/* Admin Agent toggle */}
          <div className="my-3 mx-4 border-t border-border" />
          <div className="px-2">
            <button
              onClick={() => setChatOpen((prev) => !prev)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                chatOpen
                  ? 'bg-sidebar-active text-foreground font-medium shadow-sm ring-1 ring-border/70'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-active/70'
              }`}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              Admin Agent
              {chatOpen
                ? <PanelRightClose className="w-3.5 h-3.5 ml-auto" />
                : <PanelRightOpen className="w-3.5 h-3.5 ml-auto" />
              }
            </button>
          </div>
        </nav>

        {/* Footer: theme toggle */}
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={toggle}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className={`overflow-y-auto bg-background ${chatOpen ? 'w-[60%]' : 'flex-1'}`}>
        <div className="mx-auto max-w-6xl px-8 py-7">{children}</div>
      </main>

      {/* Admin chat panel */}
      {chatOpen && (
        <div className="w-[40%] border-l border-border flex flex-col animate-slide-in-right">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              Admin Agent
            </span>
            <button
              onClick={() => setChatOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <AdminChat />
          </div>
        </div>
      )}
    </div>
  );
}
