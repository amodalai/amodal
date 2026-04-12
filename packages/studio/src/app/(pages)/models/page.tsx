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
  models?: ConfigModel[];
}

export default async function ModelsPage() {
  let config: ConfigData;
  try {
    config = await fetchFromRuntime<ConfigData>('/api/config');
  } catch {
    return <AgentOffline page="models" />;
  }

  const models = config.models ?? [];

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
