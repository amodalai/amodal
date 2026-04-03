/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';

interface ModelConfig {
  provider: string;
  model: string;
}

export function ConfigModelsPage() {
  const [models, setModels] = useState<Record<string, ModelConfig>>({});

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'models' in data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setModels((data as { models: Record<string, ModelConfig> }).models);
        }
      })
      .catch(() => {});
  }, []);

  const entries = Object.entries(models);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground mb-2">Models</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Configured in <code className="text-xs bg-muted px-1.5 py-0.5 rounded">amodal.json</code> under <code className="text-xs bg-muted px-1.5 py-0.5 rounded">models</code>.
      </p>

      {entries.length === 0 ? (
        <div className="text-sm text-muted-foreground">No models configured.</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([key, m]) => (
            <div
              key={key}
              className="border border-border rounded-xl p-5 bg-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Cpu className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {m.model.replace(/-\d{8}$/, '')}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 dark:bg-primary/10 text-primary dark:text-primary font-medium">
                        {key}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Provider: <span className="font-medium text-foreground">{m.provider}</span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{m.model}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
