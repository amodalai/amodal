/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { fetchFromRuntime } from '@/lib/runtime-client';
import { AgentOffline } from '@/components/AgentOffline';
export const dynamic = 'force-dynamic';

interface ConfigModel {
  provider: string;
  model: string;
  purpose?: string;
}

interface ConfigData {
  name: string;
  version?: string;
  description?: string;
  models?: ConfigModel[];
  providers?: Record<string, { status: string }>;
  runtime?: { version: string; nodeVersion: string; uptime?: number };
}

function StatusBadge({ status }: { status: string }) {
  const isOk = status === 'ok' || status === 'connected' || status === 'ready';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isOk ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {status}
    </span>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function OverviewPage() {
  let config: ConfigData;
  try {
    config = await fetchFromRuntime<ConfigData>('/api/config');
  } catch {
    return <AgentOffline page="overview" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Overview</h1>

      {/* Identity card */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Agent
        </h2>
        <p className="mt-1 text-lg font-semibold text-foreground">{config.name}</p>
        {config.version && (
          <p className="mt-0.5 text-sm text-muted-foreground">v{config.version}</p>
        )}
        {config.description && (
          <p className="mt-2 text-sm text-muted-foreground">{config.description}</p>
        )}
      </div>

      {/* Models */}
      {config.models && config.models.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Models
          </h2>
          <div className="space-y-2">
            {config.models.map((m, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-foreground font-medium">{m.model}</span>
                  <span className="text-muted-foreground ml-2">{m.provider}</span>
                </div>
                {m.purpose && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {m.purpose}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Providers */}
      {config.providers && Object.keys(config.providers).length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Providers
          </h2>
          <div className="space-y-2">
            {Object.entries(config.providers).map(([name, info]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{name}</span>
                <StatusBadge status={info.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Runtime info */}
      {config.runtime && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Runtime
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="text-foreground">{config.runtime.version}</dd>
            <dt className="text-muted-foreground">Node.js</dt>
            <dd className="text-foreground">{config.runtime.nodeVersion}</dd>
            {config.runtime.uptime != null && (
              <>
                <dt className="text-muted-foreground">Uptime</dt>
                <dd className="text-foreground">{formatUptime(config.runtime.uptime)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
