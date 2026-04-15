/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { AgentOffline } from '@/components/AgentOffline';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ModelsPage() {
  const { config, error, loading } = useRuntimeConfig();

  if (error) return <AgentOffline page="models" detail={error} />;
  if (loading || !config) return null;

  const modelEntries = config.models ? Object.entries(config.models) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Models</h1>

      {modelEntries.length === 0 ? (
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
              {modelEntries.map(([purpose, m]) => (
                <tr key={purpose} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-foreground">{m.provider}</td>
                  <td className="px-4 py-2 font-mono text-foreground">{m.model}</td>
                  <td className="px-4 py-2 text-muted-foreground">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
