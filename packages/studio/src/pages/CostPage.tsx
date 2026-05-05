/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Link} from 'react-router-dom';
import {useState} from 'react';
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

type RangeDays = 7 | 30 | 90;

const RANGE_OPTIONS: ReadonlyArray<{days: RangeDays; label: string}> = [
  {days: 7, label: '7D'},
  {days: 30, label: '30D'},
  {days: 90, label: '90D'},
];

function costPerSession(group: CostGroup): string {
  if (group.sessions === 0) return '—';
  return formatPrice(group.cost / group.sessions);
}

export function CostPage() {
  const {sessions, error} = useSessionHistory();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  if (error) return <AgentOffline page="cost" detail={error} />;
  if (!sessions) return null;

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - (rangeDays - 1));
  const rangedSessions = sessions.filter((session) => new Date(session.updated_at) >= rangeStart);
  const summary = summarizeCost(rangedSessions);
  const buckets = dailyCostBuckets(rangedSessions, rangeDays);
  const delta = trendDeltaPercent(buckets);
  const byModel = groupSessions(
    rangedSessions,
    (session) => session.model ?? 'unknown',
    (session) => session.model ?? 'Unknown model',
  );
  const byScope = groupSessions(
    rangedSessions,
    (session) => `${session.app_id}:${session.scope_id || 'agent'}`,
    (session) => scopeLabel(session),
  );
  const topSessions = [...rangedSessions]
    .sort((a, b) => (sessionCost(b) ?? -1) - (sessionCost(a) ?? -1))
    .slice(0, 6);
  const maxTopSessionCost = Math.max(...topSessions.map((session) => sessionCost(session) ?? 0), 0);
  const hasScopedUsage = byScope.some((group) => group.label !== 'agent scope');

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
          <div className="text-xs text-muted-foreground">estimated total in selected range</div>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-sm">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            onClick={() => setRangeDays(option.days)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              option.days === rangeDays
                ? 'bg-[hsl(var(--sidebar-active))] text-foreground shadow-sm ring-1 ring-border/70'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Sessions" value={String(rangedSessions.length)} detail={`${summary.knownCostSessions} priced`} />
        <MetricCard label="Total tokens" value={formatTokens(summary.totalTokens)} detail={`${formatTokens(summary.totalInputTokens)} in / ${formatTokens(summary.totalOutputTokens)} out`} />
        <MetricCard label="Avg cost/session" value={summary.knownCostSessions > 0 ? formatPrice(summary.totalCost / summary.knownCostSessions) : '—'} detail="estimated" />
        <MetricCard label={`${String(rangeDays)}-day trend`} value={formatTrend(delta)} detail="current vs prior period" />
      </div>

      <section className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Cost over time</h2>
            <p className="mt-1 text-xs text-muted-foreground">Daily estimated model spend from session activity.</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            Last {String(rangeDays)} days{summary.unknownCostSessions > 0 ? ` · ${String(summary.unknownCostSessions)} sessions missing pricing` : ''}
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
          <h2 className="text-sm font-semibold text-foreground">Usage by scope</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            App-supplied tenant, user, or workspace IDs used to isolate sessions and memory.
          </p>
          <div className="mt-4 space-y-3">
            {hasScopedUsage ? (
              byScope.slice(0, 6).map((group) => (
                <div key={group.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-foreground">{group.label}</span>
                      {group.label === 'agent scope' && (
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          default
                        </span>
                      )}
                    </span>
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
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/25 px-3 py-4 text-xs leading-5 text-muted-foreground">
                All sessions are currently in the default agent scope. This panel becomes useful when embedded apps pass a
                <span className="font-mono text-foreground"> scope_id </span>
                for each tenant, user, or workspace.
              </div>
            )}
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
            <col className="w-60" />
            <col className="w-32" />
            <col className="w-36" />
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
              const costPercent = cost == null ? 0 : percentOf(cost, maxTopSessionCost);
              const colors = session.model ? PROVIDER_COLORS[modelToProvider(session.model)] : null;
              return (
                <tr key={session.id} className="hover:bg-muted/25">
                  <td className="px-4 py-3">
                    <Link to={`../sessions/${session.id}`} className="block truncate font-medium text-foreground hover:underline">
                      {session.title}
                    </Link>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{session.id.slice(0, 8)}</span>
                      <span className="max-w-40 truncate rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
                        {session.scope_id || 'agent scope'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1">
                      {colors && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors.dot}`} />}
                      <span className="truncate font-mono text-xs text-muted-foreground">{session.model ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono text-xs text-muted-foreground">{formatTokens(session.token_usage.total_tokens)}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatTokens(session.token_usage.input_tokens)} in / {formatTokens(session.token_usage.output_tokens)} out
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono text-xs text-foreground">{cost == null ? '—' : `$${cost.toFixed(3)}`}</div>
                    <div className="mt-1 ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-600" style={{width: `${costPercent}%`}} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {formatShortDateTime(session.updated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {topSessions.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No sessions in this range.</p>
        )}
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
  const labelEvery = buckets.length <= 14 ? 1 : buckets.length <= 30 ? 5 : 15;
  return (
    <div
      className="mt-5 grid h-44 items-end gap-2"
      style={{gridTemplateColumns: `repeat(${String(buckets.length)}, minmax(0, 1fr))`}}
    >
      {buckets.map((bucket, index) => {
        const height = maxCost <= 0 ? 2 : Math.max(2, Math.round((bucket.cost / maxCost) * 100));
        const showLabel = index % labelEvery === 0 || index === buckets.length - 1;
        return (
          <div key={bucket.key} className="group relative flex h-full min-w-0 flex-col justify-end gap-2">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-40 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-card-foreground shadow-lg group-hover:block">
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
            <div className="min-h-3 truncate text-center text-[10px] text-muted-foreground">{showLabel ? bucket.label : ''}</div>
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
