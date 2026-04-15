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

interface EnvVar {
  name: string;
  set: boolean;
}

interface ConfigData {
  env?: EnvVar[];
  secrets?: EnvVar[];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SecretsPage() {
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

  if (error) return <AgentOffline page="secrets" />;
  if (!config) return null;

  const vars = config.env ?? config.secrets ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Secrets</h1>

      {vars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No environment variables configured.</p>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Name</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => (
                <tr key={v.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-foreground">{v.name}</td>
                  <td className="px-4 py-2">
                    {v.set ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Set
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        Missing
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
