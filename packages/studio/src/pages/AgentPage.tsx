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

export function AgentPage() {
  const { config, error, loading } = useRuntimeConfig();

  if (error) return <AgentOffline page="agent" detail={error} />;
  if (loading || !config) return null;

  const modelEntries = config.models ? Object.entries(config.models) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Agent</h1>

      <div className="bg-card border border-border rounded-lg p-4">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="text-foreground font-medium mt-0.5">{config.name}</dd>
          </div>
          {config.version && (
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="text-foreground mt-0.5">{config.version}</dd>
            </div>
          )}
          {config.description && (
            <div>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="text-foreground mt-0.5">{config.description}</dd>
            </div>
          )}
          {config.repoPath && (
            <div>
              <dt className="text-muted-foreground">Repository Path</dt>
              <dd className="text-foreground font-mono mt-0.5">{config.repoPath}</dd>
            </div>
          )}
        </dl>
      </div>

      {modelEntries.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Configured Models
            </h2>
          </div>
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
