/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';

interface AgentConfig {
  name: string;
  version: string;
  description: string;
  models: Record<string, { provider: string; model: string }>;
  repoPath: string;
}

export function ConfigAgentPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setConfig(data as AgentConfig);
        }
      })
      .catch(() => {});
  }, []);

  if (!config) return <div className="p-8 text-muted-foreground text-sm">Loading...</div>;

  const mainModel = config.models['main'];

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground mb-6">Agent</h1>

      <div className="space-y-6">
        <Field label="Name" value={config.name || '(unnamed)'} />
        <Field label="Version" value={config.version} />
        {config.description && <Field label="Description" value={config.description} />}
        <Field label="Repo Path" value={config.repoPath} mono />

        <div className="border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">Primary Model</h2>
          {mainModel ? (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground font-medium">{mainModel.model.replace(/-\d{8}$/, '')}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 dark:bg-primary/10 text-primary dark:text-primary font-medium">
                  {mainModel.provider}
                </span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">{mainModel.model}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No model configured</div>
          )}
        </div>

        {Object.keys(config.models).length > 1 && (
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Other Models</h2>
            <div className="space-y-2">
              {Object.entries(config.models)
                .filter(([key]) => key !== 'main')
                .map(([key, m]) => (
                  <div key={key} className="flex items-center justify-between bg-gray-50 dark:bg-zinc-900/30 border border-border rounded-lg px-4 py-3">
                    <div>
                      <span className="text-sm text-foreground">{key}</span>
                      <span className="text-xs text-muted-foreground ml-2 font-mono">{m.model}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{m.provider}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <div className={`text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
