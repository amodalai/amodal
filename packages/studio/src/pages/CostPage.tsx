/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Link} from 'react-router-dom';
import {AgentOffline} from '@/components/AgentOffline';
import {useSessionHistory} from '../hooks/useSessionHistory';
import {formatShortDateTime, formatTokens} from '../lib/format';
import {
  PROVIDER_COLORS,
  formatPrice,
  modelToProvider,
} from '../lib/model-pricing';
import {
  dailyCostBuckets,
  groupSessions,
  percentOf,
  scopeLabel,
  sessionCost,
  summarizeCost,
  trendDeltaPercent,
} from '../lib/cost-analytics';
import type {CostBucket, CostGroup} from '../lib/cost-analytics';

function costPerSession(group: CostGroup): string {
  if (group.sessions === 0) return '—';
  return formatPrice(group.cost / group.sessions);
}

export function CostPage() {
  const {sessions, error} = useSessionHistory();

  if (error) return <AgentOffline page="cost" detail={error} />;
  if (!sessions) return null;

  const summary = summarizeCost(sessions);
  const buckets = dailyCostBuckets(sessions, 14);
  const delta = trendDeltaPercent(buckets);
  const byModel = groupSessions(
    sessions,
    (session) => session.model ?? 'unknown',
    (session) => session.model ?? 'Unknown model',
  );
  const byScope = groupSessions(
    sessions,
    (session) => `${session.app_id}:${session.scope_id || 'agent'}`,
    (session) => scopeLabel(session),
  );
  const topSessions = [...sessions]
    .sort((a, b) => (sessionCost(b) ?? -1) - (sessionCost(a) ?? -1))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Cost & Usage</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Estimated model spend from persisted session token usage. Costs are calculated
            from Studio&apos;s pricing table and exclude platform fees.
          </p>
        </div>
        <div className="text-left md:text-right">
          <div className="text-3xl font-semibold tracking-tight text-foreground">{formatPrice(summary.totalCost)}</div>
          <div className="text-xs text-muted-foreground">estimated total in loaded history</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Sessions" value={String(sessions.length)} detail={`${summary.knownCostSessions} priced`} />
        <MetricCard label="Total tokens" value={formatTokens(summary.totalTokens)} detail={`${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out`} />
        <MetricCard label="Avg cost/session" value={summary.knownCostSessions > 0 ? formatPrice(summary.totalCost / summary.knownCostSessions) : '—'} detail="estimated" />
        <MetricCard label="14-day trend" value={formatTrend(delta)} detail="current vs prior period" />
      </div>

      <section className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Cost over time</h2>
            <p className="mt-1 text-xs text-muted-foreground">Daily estimated model spend from session activity.</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            Last 14 days · {summary.unknownCostSessions} sessions missing pricing
          </div>
        </div>
        <CostBars buckets={buckets} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="border-b border-border/70 bg-muted/25 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Cost by model</h2>
          </div>
          <div className="divide-y divide-border/70">
            {byModel.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No model usage yet.</p>
            ) : byModel.map((group) => {
              const colors = PROVIDER_COLORS[modelToProvider(group.key)];
              return (
                <div key={group.key} className="grid grid-cols-[minmax(0,220px)_1fr_88px_96px_82px] items-center gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {colors && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors.dot}`} />}
                      <span className="truncate font-mono text-xs text-foreground">{group.label}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {group.sessions} sessions · {formatTokens(group.totalTokens)} tokens
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{width: `${percentOf(group.cost, summary.totalCost)}%`}}
                    />
                  </div>
                  <div className="text-right font-mono text-xs text-foreground">{formatPrice(group.cost)}</div>
                  <div className="text-right font-mono text-xs text-muted-foreground">{costPerSession(group)}/ea</div>
                  <div className="text-right text-xs text-muted-foreground">
                    {group.unknownCostSessions > 0 ? `${group.unknownCostSessions} unpriced` : 'priced'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Scope breakdown</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Scopes are tenant or user boundaries when the embedding app supplies them.
          </p>
          <div className="mt-4 space-y-3">
            {byScope.slice(0, 6).map((group) => (
              <div key={group.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-mono text-foreground">{group.label}</span>
                  <span className="font-mono text-muted-foreground">{formatPrice(group.cost)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary-solid"
                    style={{width: `${percentOf(group.cost, summary.totalCost)}%`}}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {group.sessions} sessions · {formatTokens(group.totalTokens)} tokens
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/70 bg-muted/25 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Highest-cost sessions</h2>
        </div>
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col />
            <col className="w-52" />
            <col className="w-32" />
            <col className="w-28" />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/70 text-left text-[11px] uppercase text-muted-foreground">
              <th className="px-4 py-2 font-medium">Session</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Tokens</th>
              <th className="px-4 py-2 text-right font-medium">Est. cost</th>
              <th className="px-4 py-2 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {topSessions.map((session) => {
              const cost = sessionCost(session);
              return (
                <tr key={session.id} className="hover:bg-muted/25">
                  <td className="px-4 py-3">
                    <Link to={`../sessions/${session.id}`} className="block truncate font-medium text-foreground hover:underline">
                      {session.title}
                    </Link>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">{session.id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{session.model ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {formatTokens(session.token_usage.total_tokens)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                    {cost == null ? '—' : `$${cost.toFixed(3)}`}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {formatShortDateTime(session.updated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function formatTrend(delta: number | null): string {
  if (delta == null) return '—';
  const rounded = Math.round(delta);
  if (rounded === 0) return 'flat';
  return `${rounded > 0 ? '+' : ''}${String(rounded)}%`;
}

function CostBars({buckets}: {buckets: CostBucket[]}) {
  const maxCost = Math.max(...buckets.map((bucket) => bucket.cost), 0);
  return (
    <div
      className="mt-5 grid h-44 items-end gap-2"
      style={{gridTemplateColumns: `repeat(${String(buckets.length)}, minmax(0, 1fr))`}}
    >
      {buckets.map((bucket) => {
        const height = maxCost <= 0 ? 2 : Math.max(2, Math.round((bucket.cost / maxCost) * 100));
        return (
          <div key={bucket.key} className="group relative flex h-full min-w-0 flex-col justify-end gap-2">
            <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 hidden w-40 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs shadow-lg group-hover:block">
              <div className="font-medium text-foreground">{bucket.label}</div>
              <div className="mt-1 font-mono text-foreground">{formatPrice(bucket.cost)}</div>
              <div className="mt-1 text-muted-foreground">
                {bucket.sessions} sessions · {formatTokens(bucket.totalTokens)} tokens
              </div>
            </div>
            <div className="flex flex-1 items-end">
              <div
                className="w-full rounded-t bg-emerald-600/80 transition-colors hover:bg-emerald-600"
                style={{height: `${height}%`}}
              />
            </div>
            <div className="truncate text-center text-[10px] text-muted-foreground">{bucket.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({label, value, detail}: {label: string; value: string; detail: string}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
