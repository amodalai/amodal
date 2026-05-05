/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { AgentOffline } from '@/components/AgentOffline';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SystemPage() {
  const { config, error, loading } = useRuntimeConfig();

  if (error) return <AgentOffline page="system" detail={error} />;
  if (loading || !config) return null;

  const rows: Array<{ label: string; value: string }> = [];

  if (config.runtimeVersion) {
    rows.push({ label: 'Runtime Version', value: config.runtimeVersion });
  }
  if (config.nodeVersion) {
    rows.push({ label: 'Node.js', value: config.nodeVersion });
  }
  if (config.uptime != null) {
    rows.push({ label: 'Uptime', value: formatUptime(config.uptime) });
  }
  if (config.repoPath) {
    rows.push({ label: 'Repository Path', value: config.repoPath });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">System</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No system information available.</p>
      ) : (
        <div className="bg-card border border-border rounded-lg p-4">
          <dl className="space-y-3 text-sm">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-foreground font-mono mt-0.5">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
