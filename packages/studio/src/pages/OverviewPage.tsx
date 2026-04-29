/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Link } from 'react-router-dom';
import { AgentOffline } from '@/components/AgentOffline';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useStats } from '../hooks/useStats';
import { useGettingStarted } from '../hooks/useGettingStarted';
import { MODEL_META, PROVIDER_COLORS, modelToProvider, estimateCost, formatPrice } from '../lib/model-pricing';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

export function OverviewPage() {
  const { config, error: configError, loading: configLoading } = useRuntimeConfig();
  const { data: stats, error: statsError } = useStats();
  const { data: gettingStarted } = useGettingStarted();

  if (configError) return <AgentOffline page="dashboard" detail={configError} />;
  if (configLoading || !config) return null;

  const totalCost = stats?.topModels.reduce((sum, m) => {
    const cost = estimateCost(m.model, m.inputTokens, m.outputTokens);
    return sum + (cost ?? 0);
  }, 0) ?? 0;

  const connTotal = gettingStarted?.packages.length ?? 0;
  const connFulfilled = gettingStarted?.packages.filter((p) => p.isFulfilled).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{config.name}</h1>
        {config.description && (
          <p className="text-sm text-muted-foreground mt-1">{config.description}</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Estimated Spend"
          value={totalCost > 0 ? `$${totalCost.toFixed(2)}` : '$0.00'}
          detail={stats ? `${formatTokens(stats.tokens.total)} tokens` : null}
        />
        <SummaryCard
          label="Sessions"
          value={String(stats?.sessions ?? 0)}
          detail={stats?.lastActive ? `Last active ${formatTimeAgo(stats.lastActive)}` : null}
          link="sessions"
        />
        <SummaryCard
          label="Connections"
          value={connTotal > 0 ? `${connFulfilled}/${connTotal}` : '—'}
          detail={connTotal > 0 ? `${connTotal - connFulfilled} need credentials` : 'No packages installed'}
          link="connections"
        />
        <SummaryCard
          label="Providers"
          value={String(config.providerStatuses?.filter((p) => p.verified).length ?? 0)}
          detail={`${config.providerStatuses?.length ?? 0} configured`}
        />
      </div>

      {/* Cost breakdown by model */}
      {stats && stats.topModels.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Usage by Model
          </h2>
          <div className="space-y-2">
            {stats.topModels.map((m) => {
              const cost = estimateCost(m.model, m.inputTokens, m.outputTokens);
              const meta = MODEL_META[m.model];
              const colors = PROVIDER_COLORS[modelToProvider(m.model)];
              return (
                <div key={m.model} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {colors && <span className={`w-2 h-2 rounded-full ${colors.dot}`} />}
                    <span className="text-foreground font-mono text-xs">{m.model}</span>
                    {meta && (
                      <span className="text-[10px] text-muted-foreground">{meta.context} ctx</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">{m.sessions} sessions</span>
                    <span className="text-muted-foreground">{formatTokens(m.totalTokens)} tokens</span>
                    {cost != null && (
                      <span className="font-mono text-foreground">{formatPrice(cost)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {statsError && (
        <p className="text-xs text-destructive">Failed to load stats: {statsError}</p>
      )}

      {/* Provider status */}
      {config.providerStatuses && config.providerStatuses.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Providers
          </h2>
          <div className="space-y-2">
            {config.providerStatuses.map((ps) => (
              <div key={ps.provider} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {PROVIDER_COLORS[ps.provider] && (
                    <span className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[ps.provider].dot}`} />
                  )}
                  <span className="text-foreground capitalize">{ps.provider}</span>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  ps.verified
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : ps.keySet
                      ? 'bg-red-500/10 text-red-600'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    ps.verified ? 'bg-emerald-500' : ps.keySet ? 'bg-red-500' : 'bg-muted-foreground/40'
                  }`} />
                  {ps.verified ? 'Verified' : ps.keySet ? 'Key invalid' : 'No API key'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Runtime info */}
      {(config.runtimeVersion ?? config.nodeVersion ?? config.uptime) != null && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Runtime
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {config.runtimeVersion && (
              <>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="text-foreground">{config.runtimeVersion}</dd>
              </>
            )}
            {config.nodeVersion && (
              <>
                <dt className="text-muted-foreground">Node.js</dt>
                <dd className="text-foreground">{config.nodeVersion}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail, link }: {
  label: string;
  value: string;
  detail: string | null;
  link?: string;
}) {
  const content = (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
    </div>
  );
  if (link) {
    return <Link to={link} className="block hover:ring-1 hover:ring-primary/30 rounded-lg transition-shadow">{content}</Link>;
  }
  return content;
}
