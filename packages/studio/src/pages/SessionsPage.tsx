/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Fragment, useMemo, useState, useEffect} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {AgentOffline} from '@/components/AgentOffline';
import {runtimeApiUrl} from '@/lib/api';
import {
  PROVIDER_COLORS,
  modelToProvider,
  estimateCost,
} from '../lib/model-pricing';
import {formatShortDateTime, formatTokens} from '@/lib/format';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Wrench,
} from 'lucide-react';

interface SessionRow {
  id: string;
  app_id: string;
  scope_id: string;
  title: string;
  message_count: number;
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolCall {
  toolName: string;
}

interface HistoryMessage {
  role?: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
}

interface SessionDetail extends SessionRow {
  messages: HistoryMessage[];
}

type SortKey = 'title' | 'model' | 'app_scope' | 'messages' | 'tokens' | 'cost' | 'updated';
type SortDirection = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

function compactText(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function firstMessage(messages: HistoryMessage[], role: 'user' | 'assistant'): string {
  return messages.find((m) => m.role === role && m.text.trim().length > 0)?.text ?? '—';
}

function countToolCalls(messages: HistoryMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0);
}

function modelLabel(model: string): string {
  const known = MODEL_LABELS[model];
  if (known) return known;
  return model
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function providerLabel(model: string | null, provider: string | null): string {
  if (provider) return provider;
  if (!model) return '';
  return modelToProvider(model);
}

function sessionCost(session: SessionRow): number | null {
  return session.model
    ? estimateCost(session.model, session.token_usage.input_tokens, session.token_usage.output_tokens)
    : null;
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function sortValue(session: SessionRow, key: SortKey): string | number | null {
  switch (key) {
    case 'title':
      return session.title.toLowerCase();
    case 'model':
      return (session.model ?? '').toLowerCase();
    case 'app_scope':
      return `${session.app_id}:${session.scope_id}`.toLowerCase();
    case 'messages':
      return session.message_count;
    case 'tokens':
      return session.token_usage.total_tokens;
    case 'cost':
      return sessionCost(session);
    case 'updated':
      return new Date(session.updated_at).getTime();
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

function compareSessions(a: SessionRow, b: SessionRow, key: SortKey): number {
  const aValue = sortValue(a, key);
  const bValue = sortValue(b, key);
  if (typeof aValue === 'number' || typeof bValue === 'number' || aValue === null || bValue === null) {
    return compareNullableNumber(
      typeof aValue === 'number' ? aValue : null,
      typeof bValue === 'number' ? bValue : null,
    );
  }
  return aValue.localeCompare(bValue);
}

function SortHeader({
  label,
  sortKey,
  sort,
  align = 'left',
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  align?: 'left' | 'right';
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-4 py-3 text-[11px] font-medium tracking-wide ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground ${active ? 'text-foreground' : ''} ${align === 'right' ? 'justify-end' : 'justify-start'}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className={`h-3 w-3 ${active ? 'opacity-80' : 'opacity-35'}`} />
      </button>
    </th>
  );
}

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SessionDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>({key: 'updated', direction: 'desc'});

  useEffect(() => {
    fetch(runtimeApiUrl('/sessions/history'), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionRow[]>;
      })
      .then(setSessions)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const toggleExpanded = (sessionId: string) => {
    const nextId = expandedId === sessionId ? null : sessionId;
    setExpandedId(nextId);
    if (!nextId || details[nextId] || detailErrors[nextId]) return;

    fetch(runtimeApiUrl(`/sessions/history/${nextId}`), {signal: AbortSignal.timeout(5_000)})
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionDetail>;
      })
      .then((detail) => {
        setDetails((current) => ({...current, [nextId]: detail}));
      })
      .catch((err: unknown) => {
        setDetailErrors((current) => ({
          ...current,
          [nextId]: err instanceof Error ? err.message : String(err),
        }));
      });
  };

  const sortedSessions = useMemo(() => {
    if (!sessions) return [];
    return [...sessions].sort((a, b) => {
      const result = compareSessions(a, b, sort.key);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [sessions, sort]);

  const updateSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  if (error) return <AgentOffline page="sessions" detail={error} />;
  if (!sessions) return null;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Review recent agent conversations, inspect replay details, and compare
          model usage across app and scope boundaries.
        </p>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-12" />
              <col />
              <col className="w-48" />
              <col className="w-44" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="border-b border-border/70 bg-muted/25 text-xs uppercase">
                <th className="w-10 px-2 py-2" aria-label="Expand" />
                <SortHeader label="Title" sortKey="title" sort={sort} onSort={updateSort} />
                <SortHeader label="Model" sortKey="model" sort={sort} onSort={updateSort} />
                <SortHeader label="App / Scope" sortKey="app_scope" sort={sort} onSort={updateSort} />
                <SortHeader label="Messages" sortKey="messages" sort={sort} align="right" onSort={updateSort} />
                <SortHeader label="Tokens" sortKey="tokens" sort={sort} align="right" onSort={updateSort} />
                <SortHeader label="Est. Cost" sortKey="cost" sort={sort} align="right" onSort={updateSort} />
                <SortHeader label="Last Active" sortKey="updated" sort={sort} align="right" onSort={updateSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {sortedSessions.map((s) => {
                const cost = sessionCost(s);
                const colors = s.model ? PROVIDER_COLORS[modelToProvider(s.model)] : null;
                const isExpanded = expandedId === s.id;
                const detail = details[s.id];
                const toolCalls = detail ? countToolCalls(detail.messages) : 0;
                return (
                  <Fragment key={s.id}>
                    <tr
                      key={s.id}
                      className="cursor-pointer transition-colors hover:bg-muted/30"
                      role="link"
                      tabIndex={0}
                      onClick={() => { void navigate(s.id); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void navigate(s.id);
                        }
                      }}
                    >
                      <td className="px-2 py-4 align-middle">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={isExpanded ? 'Collapse session summary' : 'Expand session summary'}
                          aria-expanded={isExpanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(s.id);
                          }}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <Link
                          to={s.id}
                          className="block truncate font-medium text-foreground hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {s.title}
                        </Link>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                          {s.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        {s.model ? (
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {colors && <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />}
                              <span className="truncate text-xs font-medium text-foreground">
                                {modelLabel(s.model)}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
                              {providerLabel(s.model, s.provider)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <div className="min-w-0 space-y-1">
                          <div className="truncate font-mono text-xs text-foreground/80">{s.app_id}</div>
                          <div className="inline-flex max-w-full rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                            <span className="truncate">{s.scope_id || 'agent scope'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-muted-foreground align-middle">{s.message_count}</td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-muted-foreground align-middle">
                        {formatTokens(s.token_usage.total_tokens)}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-foreground align-middle">
                        {cost != null ? `$${cost.toFixed(3)}` : '—'}
                      </td>
                      <td className="px-4 py-4 text-right text-xs text-muted-foreground align-middle">
                        {formatShortDateTime(s.updated_at)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${s.id}-summary`} className="bg-muted/20">
                        <td colSpan={8} className="px-4 py-4">
                          {detailErrors[s.id] ? (
                            <div className="text-sm text-destructive">{detailErrors[s.id]}</div>
                          ) : detail ? (
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
                              <div className="rounded-lg border border-border bg-card p-3">
                                <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Prompt</div>
                                <p className="text-sm leading-6 text-foreground">{compactText(firstMessage(detail.messages, 'user'))}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-card p-3">
                                <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Response</div>
                                <p className="text-sm leading-6 text-foreground">{compactText(firstMessage(detail.messages, 'assistant'))}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-card p-3">
                                <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">Activity</div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                    <Wrench className="h-3.5 w-3.5" />
                                    Tool calls
                                  </span>
                                  <span className="font-mono text-foreground">{toolCalls}</span>
                                </div>
                                <Link
                                  to={s.id}
                                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-foreground hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Open replay
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">Loading summary...</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
