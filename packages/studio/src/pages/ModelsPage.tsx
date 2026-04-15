/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { AgentOffline } from '@/components/AgentOffline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigModel {
  provider: string;
  model: string;
  purpose?: string;
}

interface ConfigData {
  models?: Record<string, { provider: string; model: string }> | ConfigModel[];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ModelsPage() {
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

  if (error) return <AgentOffline page="models" />;
  if (!config) return null;

  const rawModels = config.models;
  const models: ConfigModel[] = Array.isArray(rawModels)
    ? rawModels
    : rawModels
      ? Object.entries(rawModels).map(([purpose, m]) => ({ ...m, purpose }))
      : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Models</h1>

      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">No models configured.</p>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Provider</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Model</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-foreground">{m.provider}</td>
                  <td className="px-4 py-2 font-mono text-foreground">{m.model}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.purpose ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
