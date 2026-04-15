/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useStudioConfig } from '../App';
import { AgentOffline } from '@/components/AgentOffline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigData {
  repoPath?: string;
  storeBackend?: string;
  runtime?: {
    version: string;
    nodeVersion: string;
    uptime?: number;
  };
}

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
  const { runtimeUrl } = useStudioConfig();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${runtimeUrl}/api/config`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<ConfigData>;
      })
      .then(setConfig)
      .catch(() => setError(true));
  }, [runtimeUrl]);

  if (error) return <AgentOffline page="system" />;
  if (!config) return null;

  const rows: Array<{ label: string; value: string }> = [];

  if (config.runtime?.version) {
    rows.push({ label: 'Runtime Version', value: config.runtime.version });
  }
  if (config.runtime?.nodeVersion) {
    rows.push({ label: 'Node.js', value: config.runtime.nodeVersion });
  }
  if (config.runtime?.uptime != null) {
    rows.push({ label: 'Uptime', value: formatUptime(config.runtime.uptime) });
  }
  if (config.storeBackend) {
    rows.push({ label: 'Store Backend', value: config.storeBackend });
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
