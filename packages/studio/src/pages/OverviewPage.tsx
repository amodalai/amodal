/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Link} from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Cpu,
  MessageSquare,
  Plug,
  TrendingUp,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import {AgentOffline} from '@/components/AgentOffline';
import {useRuntimeConfig} from '../hooks/useRuntimeConfig';
import {useStats} from '../hooks/useStats';
import {useConnectionPackages} from '../hooks/useConnectionPackages';
import type {ConnectionPackage} from '../hooks/useConnectionPackages';
import {MODEL_META, PROVIDER_COLORS, modelDisplayName, modelToProvider, formatPrice} from '../lib/model-pricing';
import {useSessionHistory} from '../hooks/useSessionHistory';
import type {SessionHistoryRow} from '../hooks/useSessionHistory';
import {
  dailyCostBuckets,
  groupSessions,
  percentOf,
  scopeLabel,
  sessionCost,
  summarizeCost,
  trendDeltaPercent,
} from '../lib/cost-analytics';
import {formatTokens} from '../lib/format';
import {CONNECTIONS_PATH, COST_PATH, SESSIONS_PATH, sessionPath} from '../lib/routes';

const RECENT_ACTIVITY_LIMIT = 5;
const STALE_SESSION_DAYS = 7;

interface ActionItem {
  label: string;
  detail: string;
  tone: 'danger' | 'warning' | 'neutral';
  link?: string;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatOverviewTrend(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return 'Flat';
  return `${rounded > 0 ? '+' : ''}${String(rounded)}%`;
}

function connectionGapCount(packages: ConnectionPackage[] | undefined): number {
  if (!packages) return 0;
  return packages.filter((pkg) => !pkg.isFulfilled).length;
}

function buildActionItems({
  sessions,
  lastActive,
  connectionGaps,
  providerIssues,
  unknownCostSessions,
}: {
  sessions: SessionHistoryRow[] | null;
  lastActive: string | null | undefined;
  connectionGaps: number;
  providerIssues: number;
  unknownCostSessions: number;
}): ActionItem[] {
  const items: ActionItem[] = [];
  if (providerIssues > 0) {
    items.push({
      label: 'Provider credentials need attention',
      detail: `${String(providerIssues)} provider${providerIssues === 1 ? '' : 's'} not verified`,
      tone: 'danger',
    });
  }
  if (connectionGaps > 0) {
    items.push({
      label: 'Connection setup is incomplete',
      detail: `${String(connectionGaps)} package${connectionGaps === 1 ? '' : 's'} missing credentials`,
      tone: 'warning',
      link: CONNECTIONS_PATH,
    });
  }
  if (unknownCostSessions > 0) {
    items.push({
      label: 'Session cost needs pricing metadata',
      detail: `${String(unknownCostSessions)} session${unknownCostSessions === 1 ? '' : 's'} without cost snapshot`,
      tone: 'warning',
      link: COST_PATH,
    });
  }
  if (sessions && sessions.length === 0) {
    items.push({
      label: 'No sessions recorded yet',
      detail: 'Run a conversation to verify the agent path end to end',
      tone: 'neutral',
      link: SESSIONS_PATH,
    });
  } else if (lastActive) {
    const lastActiveTime = new Date(lastActive).getTime();
    const staleCutoff = Date.now() - STALE_SESSION_DAYS * 24 * 60 * 60 * 1000;
    if (lastActiveTime < staleCutoff) {
      items.push({
        label: 'No recent session activity',
        detail: `Last active ${formatTimeAgo(lastActive)}`,
        tone: 'neutral',
        link: SESSIONS_PATH,
      });
    }
  }
  return items;
}

export function OverviewPage() {
  const {config, error: configError, loading: configLoading} = useRuntimeConfig();
  const {data: stats, error: statsError} = useStats();
  const {data: connectionPackages} = useConnectionPackages();
  const {sessions} = useSessionHistory();

  if (configError) return <AgentOffline page="dashboard" detail={configError} />;
  if (configLoading || !config) return null;

  const sessionCostSummary = sessions ? summarizeCost(sessions) : null;
  const costBuckets = sessions ? dailyCostBuckets(sessions, 14) : [];
  const costTrend = costBuckets.length > 0 ? trendDeltaPercent(costBuckets) : null;
  const costByModel = sessions
    ? groupSessions(
      sessions,
      (session) => session.model ?? 'unknown',
      (session) => session.model ?? 'Unknown model',
    ).slice(0, 4)
    : [];
  const scopeGroups = sessions
    ? groupSessions(
      sessions,
      (session) => `${session.app_id}:${session.scope_id || 'agent'}`,
      (session) => scopeLabel(session),
    ).slice(0, 4)
    : [];
  const recentSessions = sessions
    ? [...sessions]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, RECENT_ACTIVITY_LIMIT)
    : [];

  const connTotal = connectionPackages?.packages.length ?? 0;
  const connGaps = connectionGapCount(connectionPackages?.packages);
  const connFulfilled = connTotal - connGaps;
  const providerStatuses = config.providerStatuses ?? [];
  const verifiedProviders = providerStatuses.filter((provider) => provider.verified).length;
  const providerIssues = providerStatuses.filter((provider) => !provider.verified).length;
  const unknownCostSessions = sessionCostSummary?.unknownCostSessions ?? 0;
  const actionItems = buildActionItems({
    sessions,
    lastActive: stats?.lastActive,
    connectionGaps: connGaps,
    providerIssues,
    unknownCostSessions,
  });

  const totalSpend = sessionCostSummary ? formatPrice(sessionCostSummary.totalCost) : '$0.00';
  const sessionTotal = stats?.sessions ?? sessions?.length ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{config.name}</h1>
          {config.description && (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{config.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {config.runtimeVersion && <span>Runtime {config.runtimeVersion}</span>}
          {config.nodeVersion && <span>Node {config.nodeVersion}</span>}
          {stats?.lastActive && <span>Last active {formatTimeAgo(stats.lastActive)}</span>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={CircleDollarSign}
          label="Spend"
          value={totalSpend}
          detail={costTrend == null ? 'Estimated model cost' : `${formatOverviewTrend(costTrend)} vs prior period`}
          link={COST_PATH}
        />
        <SummaryCard
          icon={MessageSquare}
          label="Sessions"
          value={String(sessionTotal)}
          detail={stats?.lastActive ? `Last active ${formatTimeAgo(stats.lastActive)}` : 'No activity yet'}
          link={SESSIONS_PATH}
        />
        <SummaryCard
          icon={Plug}
          label="Connections"
          value={connTotal > 0 ? `${String(connFulfilled)}/${String(connTotal)}` : '0'}
          detail={connTotal > 0 ? connectionDetail(connGaps) : 'No packages installed'}
          link={CONNECTIONS_PATH}
        />
        <SummaryCard
          icon={Cpu}
          label="Providers"
          value={providerStatuses.length > 0 ? `${String(verifiedProviders)}/${String(providerStatuses.length)}` : '0'}
          detail={providerStatuses.length > 0 ? providerDetail(providerIssues) : 'No providers configured'}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Session Trend"
          action={<Link to={COST_PATH} className="text-xs text-muted-foreground hover:text-foreground">View cost</Link>}
        >
          {sessions ? (
            <MiniCostBars buckets={costBuckets} />
          ) : (
            <EmptyPanelText>Loading session history</EmptyPanelText>
          )}
        </Panel>

        <Panel title="Action Items">
          <ActionItems items={actionItems} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Panel
          title="Recent Activity"
          action={<Link to={SESSIONS_PATH} className="text-xs text-muted-foreground hover:text-foreground">View sessions</Link>}
        >
          <RecentActivity sessions={recentSessions} />
        </Panel>

        <Panel title="Connection Health">
          <ConnectionHealth packages={connectionPackages?.packages ?? []} providers={providerStatuses} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Usage by Model">
          <UsageByModel groups={costByModel} />
        </Panel>

        <Panel title="Top Scopes">
          <TopScopes groups={scopeGroups} />
        </Panel>
      </section>

      {statsError && (
        <p className="text-xs text-destructive">Failed to load stats: {statsError}</p>
      )}
    </div>
  );
}

function connectionDetail(gaps: number): string {
  if (gaps === 0) return 'All credentials set';
  return `${String(gaps)} need credentials`;
}

function providerDetail(issues: number): string {
  if (issues === 0) return 'All providers verified';
  return `${String(issues)} not verified`;
}

function Panel({title, action, children}: {title: string; action?: ReactNode; children: ReactNode}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  link,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  link?: string;
}) {
  const content = (
    <div className="rounded-lg border border-border bg-card p-4 transition-shadow hover:ring-1 hover:ring-primary/30">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
  if (link) return <Link to={link} className="block rounded-lg">{content}</Link>;
  return content;
}

function MiniCostBars({buckets}: {buckets: Array<{key: string; label: string; cost: number; sessions: number; totalTokens: number}>}) {
  const maxCost = Math.max(...buckets.map((bucket) => bucket.cost), 0);
  const totalCost = buckets.reduce((sum, bucket) => sum + bucket.cost, 0);
  const totalSessions = buckets.reduce((sum, bucket) => sum + bucket.sessions, 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-foreground">{formatPrice(totalCost)}</p>
          <p className="text-xs text-muted-foreground">Last 14 days · {String(totalSessions)} sessions</p>
        </div>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </div>
      <div
        className="mt-4 grid h-28 items-end gap-1.5"
        style={{gridTemplateColumns: `repeat(${String(buckets.length)}, minmax(0, 1fr))`}}
      >
        {buckets.map((bucket) => {
          const height = maxCost <= 0 ? 2 : percentOf(bucket.cost, maxCost);
          return (
            <div key={bucket.key} className="group relative flex h-full items-end">
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-44 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs text-popover-foreground shadow-lg group-hover:block">
                <div className="font-medium text-foreground">{bucket.label}</div>
                <div className="mt-1 font-mono text-foreground">{formatPrice(bucket.cost)}</div>
                <div className="mt-1 text-muted-foreground">
                  {String(bucket.sessions)} sessions · {formatTokens(bucket.totalTokens)}
                </div>
              </div>
              <div
                className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                style={{height: `${String(height)}%`}}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionItems({items}: {items: ActionItem[]}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        No active action items
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const row = (
          <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
            <AlertCircle className={`mt-0.5 h-4 w-4 ${actionIconClass(item.tone)}`} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        );
        if (item.link) {
          return <Link key={`${item.label}:${item.detail}`} to={item.link} className="block">{row}</Link>;
        }
        return <div key={`${item.label}:${item.detail}`}>{row}</div>;
      })}
    </div>
  );
}

function actionIconClass(tone: ActionItem['tone']): string {
  if (tone === 'danger') return 'text-destructive';
  if (tone === 'warning') return 'text-amber-600';
  return 'text-muted-foreground';
}

function RecentActivity({sessions}: {sessions: SessionHistoryRow[]}) {
  if (sessions.length === 0) return <EmptyPanelText>No sessions recorded yet</EmptyPanelText>;
  return (
    <div className="divide-y divide-border">
      {sessions.map((session) => (
        <Link
          key={session.id}
          to={sessionPath(session.id)}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{session.title || session.id}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(session.updated_at)}
              <span>{String(session.message_count)} messages</span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm text-foreground">{formatPrice(sessionCost(session) ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{formatTokens(session.token_usage.total_tokens)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ConnectionHealth({
  packages,
  providers,
}: {
  packages: ConnectionPackage[];
  providers: Array<{provider: string; keySet: boolean; verified: boolean}>;
}) {
  if (packages.length === 0 && providers.length === 0) {
    return <EmptyPanelText>No connections or providers configured</EmptyPanelText>;
  }
  return (
    <div className="space-y-4">
      {packages.length > 0 && (
        <div className="space-y-2">
          {packages.slice(0, 4).map((pkg) => (
            <HealthRow
              key={pkg.name}
              label={pkg.displayName || pkg.name}
              detail={pkg.isFulfilled ? 'Credentials set' : missingEnvVarText(pkg)}
              ok={pkg.isFulfilled}
            />
          ))}
        </div>
      )}
      {providers.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          {providers.map((provider) => (
            <HealthRow
              key={provider.provider}
              label={provider.provider}
              detail={provider.verified ? 'Verified' : provider.keySet ? 'Key invalid' : 'No API key'}
              ok={provider.verified}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HealthRow({label, detail, ok}: {label: string; detail: string; ok: boolean}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="truncate text-foreground capitalize">{label}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'
      }`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {detail}
      </span>
    </div>
  );
}

function missingEnvVarText(pkg: ConnectionPackage): string {
  const missing = pkg.envVars.filter((envVar) => !envVar.set).length;
  if (missing === 0) return 'Needs setup';
  return `${String(missing)} env var${missing === 1 ? '' : 's'} missing`;
}

function UsageByModel({groups}: {groups: ReturnType<typeof groupSessions>}) {
  if (groups.length === 0) return <EmptyPanelText>No model usage yet</EmptyPanelText>;
  const maxCost = Math.max(...groups.map((group) => group.cost), 0);
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const meta = MODEL_META[group.key];
        const colors = PROVIDER_COLORS[modelToProvider(group.key)];
        return (
          <div key={group.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                {colors && <span className={`h-2 w-2 rounded-full ${colors.dot}`} />}
                <span className="truncate text-foreground">{modelDisplayName(group.key)}</span>
                {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta.context} ctx</span>}
              </div>
              <span className="shrink-0 font-mono text-foreground">{formatPrice(group.cost)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{width: `${String(percentOf(group.cost, maxCost))}%`}} />
            </div>
            <p className="text-xs text-muted-foreground">
              {String(group.sessions)} sessions · {formatTokens(group.inputTokens)} in · {formatTokens(group.outputTokens)} out
            </p>
          </div>
        );
      })}
    </div>
  );
}

function TopScopes({groups}: {groups: ReturnType<typeof groupSessions>}) {
  if (groups.length === 0) return <EmptyPanelText>No scoped usage yet</EmptyPanelText>;
  const maxCost = Math.max(...groups.map((group) => group.cost), 0);
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="truncate text-sm font-medium text-foreground">{group.label}</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-600/70" style={{width: `${String(percentOf(group.cost, maxCost))}%`}} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {String(group.sessions)} sessions · {formatTokens(group.totalTokens)}
            </p>
          </div>
          <p className="font-mono text-sm text-foreground">{formatPrice(group.cost)}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyPanelText({children}: {children: ReactNode}) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}
