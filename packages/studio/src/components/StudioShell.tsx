/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useLocation, Link } from 'react-router-dom';
import { useTheme } from './ThemeProvider';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import {
  LayoutDashboard,
  FileCode,
  Database,
  Zap,
  FlaskConical,
  MessageSquare,
  Bot,
  ScrollText,
  KeyRound,
  Cpu,
  Settings,
  Moon,
  Sun,
  ExternalLink,
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
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/files', label: 'Files', icon: FileCode },
  { href: '/stores', label: 'Stores', icon: Database },
  { href: '/automations', label: 'Automations', icon: Zap },
  { href: '/evals', label: 'Evals', icon: FlaskConical },
  { href: '/feedback', label: 'Feedback', icon: MessageSquare },
  { href: '/chat', label: 'Admin Chat', icon: Bot },
];

const SECONDARY_NAV: readonly NavItem[] = [
  { href: '/prompt', label: 'Prompt', icon: ScrollText },
  { href: '/secrets', label: 'Secrets', icon: KeyRound },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/system', label: 'System', icon: Settings },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
    </Link>
  );
}

export function StudioShell({ children }: Props) {
  const { pathname } = useLocation();
  const { agentName, runtimeUrl } = useStudioConfig();
  const { dark, toggle } = useTheme();

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
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
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>

          <div className="my-3 mx-4 border-t border-border" />

          <div className="px-2 space-y-0.5">
            {SECONDARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
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
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
