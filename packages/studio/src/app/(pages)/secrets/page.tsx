/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { fetchFromRuntime } from '@/lib/runtime-client';
import { AgentOffline } from '@/components/AgentOffline';

interface EnvVar {
  name: string;
  set: boolean;
}

interface ConfigData {
  env?: EnvVar[];
  secrets?: EnvVar[];
}

export default async function SecretsPage() {
  let config: ConfigData;
  try {
    config = await fetchFromRuntime<ConfigData>('/api/config');
  } catch {
    return <AgentOffline page="secrets" />;
  }

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
