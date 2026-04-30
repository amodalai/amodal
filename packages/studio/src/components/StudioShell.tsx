/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { useTheme } from './ThemeProvider';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { AdminChat } from './views/AdminChat';
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
  Moon,
  Sun,
  ExternalLink,
  Sparkles,
  BookOpen,
  Plug,
  FileText,
  PanelRightOpen,
  PanelRightClose,
  Brain,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAgentInventory } from '../hooks/useAgentInventory';
import { CollapsibleSection } from './studio/CollapsibleSection';

interface Props {
  children: React.ReactNode;
}

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** The agent's repo contents — maps to directories in the repo. */
const AGENT_NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/connections', label: 'Connections', icon: Plug },
  { href: '/evals', label: 'Evals', icon: FlaskConical },
];

/** Live runtime state — only exists when the agent is running. */
const RUNTIME_NAV: readonly NavItem[] = [
  { href: '/sessions', label: 'Sessions', icon: MessageSquare },
  { href: '/feedback', label: 'Feedback', icon: MessageSquare },
  { href: '/memory', label: 'Memory', icon: Brain },
];

/** Developer plumbing and diagnostics. */
const TOOLS_NAV: readonly NavItem[] = [
  { href: '/arena', label: 'Arena', icon: FlaskConical },
  { href: '/files', label: 'Files', icon: FileCode },
  { href: '/prompt', label: 'Prompt', icon: ScrollText },
  { href: '/secrets', label: 'Secrets', icon: KeyRound },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/system', label: 'System', icon: Settings },
];

function SidebarNavLink({ item, active, to }: { item: NavItem; active: boolean; to: string }) {
  const Icon = item.icon;
  return (
    <Link
      to={to}
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

interface InventorySectionDef {
  readonly key: 'skills' | 'knowledge' | 'connections' | 'stores' | 'automations' | 'pages';
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconColor: string;
  readonly pathPrefix: string;
}

const INVENTORY_SECTIONS: readonly InventorySectionDef[] = [
  { key: 'skills', label: 'Skills', icon: Sparkles, iconColor: 'text-amber-500/60', pathPrefix: '/inspect/skills' },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen, iconColor: 'text-blue-500/60', pathPrefix: '/inspect/knowledge' },
  { key: 'stores', label: 'Stores', icon: Database, iconColor: 'text-violet-500/60', pathPrefix: '/stores' },
  { key: 'automations', label: 'Automations', icon: Zap, iconColor: 'text-orange-500/60', pathPrefix: '/automations' },
  { key: 'pages', label: 'Pages', icon: FileText, iconColor: 'text-cyan-500/60', pathPrefix: '/pages' },
];

export function StudioShell({ children }: Props) {
  const { pathname } = useLocation();
  const { agentId } = useParams();
  const { agentName, runtimeUrl } = useStudioConfig();
  const { dark, toggle } = useTheme();
  const inventory = useAgentInventory();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState<string | undefined>(undefined);

  // Listen for programmatic open from the onboarding wizard
  useEffect(() => {
    const handler = (e: Event) => {
      setChatOpen(true);
      // Extract seed message if provided via CustomEvent detail
      if ('detail' in e) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting detail from CustomEvent
        const obj = e as unknown as Record<string, unknown>;
        if (typeof obj['detail'] === 'string') {
          setChatSeed(obj['detail']);
        }
      }
    };
    window.addEventListener('admin-chat-open', handler);
    return () => window.removeEventListener('admin-chat-open', handler);
  }, []);

  const basePath = `/agents/${agentId ?? 'local'}`;

  /** Resolve a nav href to an agent-scoped absolute path */
  const agentPath = (href: string) =>
    href === '/' ? basePath : `${basePath}${href}`;

  const isActive = (href: string) => {
    const full = agentPath(href);
    return pathname === full || (href !== '/' && pathname.startsWith(full));
  };

  return (
    <div className="flex h-screen overflow-hidden">
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

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {/* Agent — repo contents */}
          <div className="px-2 space-y-0.5">
            {AGENT_NAV.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          {/* Agent inventory — collapsible per-type lists */}
          {!inventory.loading && INVENTORY_SECTIONS.some((s) => inventory[s.key].length > 0) && (
            <div className="px-2 space-y-0.5 mt-1">
              {INVENTORY_SECTIONS.map((section) => {
                const items = inventory[section.key];
                if (items.length === 0) return null;
                return (
                  <CollapsibleSection
                    key={section.key}
                    label={section.label}
                    icon={section.icon}
                    iconColor={section.iconColor}
                    count={items.length}
                  >
                    {items.map((name) => (
                      <Link
                        key={name}
                        to={agentPath(`${section.pathPrefix}/${name}`)}
                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors ${
                          pathname === agentPath(`${section.pathPrefix}/${name}`)
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        <section.icon className={`w-3 h-3 flex-shrink-0 ${section.iconColor}`} />
                        {name}
                      </Link>
                    ))}
                  </CollapsibleSection>
                );
              })}
            </div>
          )}

          {/* Runtime — live state */}
          <div className="my-3 mx-4 border-t border-border" />
          <div className="px-2 space-y-0.5">
            {RUNTIME_NAV.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          {/* Tools — developer plumbing */}
          <div className="my-3 mx-4 border-t border-border" />
          <div className="px-2 space-y-0.5">
            {TOOLS_NAV.map((item) => (
              <SidebarNavLink key={item.href} item={item} active={isActive(item.href)} to={agentPath(item.href)} />
            ))}
          </div>

          {/* Admin Agent toggle */}
          <div className="my-3 mx-4 border-t border-border" />
          <div className="px-2">
            <button
              onClick={() => setChatOpen((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors w-full ${
                chatOpen
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
        <div className="max-w-5xl mx-auto px-6 py-6">{children}</div>
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
            <AdminChat initialMessage={chatSeed} />
          </div>
        </div>
      )}
    </div>
  );
}
